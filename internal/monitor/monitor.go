package monitor

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"
)

type Target struct {
	ID          string `json:"id"`
	Project     string `json:"project"`
	Section     string `json:"section"`
	Name        string `json:"name"`
	URL         string `json:"url"`
	Environment string `json:"environment"`
	Group       string `json:"group"`
}

type Result struct {
	Target
	StatusCode int       `json:"statusCode"`
	LatencyMS  int64     `json:"latencyMs"`
	CheckedAt  time.Time `json:"checkedAt"`
	Healthy    bool      `json:"healthy"`
	Error      string    `json:"error,omitempty"`
}

type Checker struct {
	client  *http.Client
	workers int
}

func NewChecker(workers int, timeout time.Duration) *Checker {
	if workers < 1 {
		workers = 1
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConns = workers * 2
	transport.MaxIdleConnsPerHost = 2
	transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	return &Checker{
		workers: workers,
		client: &http.Client{
			Timeout:   timeout,
			Transport: transport,
			CheckRedirect: func(_ *http.Request, via []*http.Request) error {
				if len(via) >= 5 {
					return errors.New("too many redirects")
				}
				return nil
			},
		},
	}
}

func LoadTargets(reader io.Reader) ([]Target, error) {
	var targets []Target
	if err := json.NewDecoder(reader).Decode(&targets); err != nil {
		return nil, fmt.Errorf("decode targets: %w", err)
	}
	seen := make(map[string]struct{}, len(targets))
	for _, target := range targets {
		if target.ID == "" || target.Name == "" {
			return nil, errors.New("every target needs an id and name")
		}
		parsed, err := url.ParseRequestURI(target.URL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return nil, fmt.Errorf("target %q must use a valid HTTP or HTTPS URL", target.ID)
		}
		if _, exists := seen[target.ID]; exists {
			return nil, fmt.Errorf("duplicate target id %q", target.ID)
		}
		seen[target.ID] = struct{}{}
	}
	return targets, nil
}

func (c *Checker) CheckAll(ctx context.Context, targets []Target) []Result {
	type job struct {
		index  int
		target Target
	}
	jobs := make(chan job)
	results := make([]Result, len(targets))
	var group sync.WaitGroup

	for range c.workers {
		group.Add(1)
		go func() {
			defer group.Done()
			for work := range jobs {
				results[work.index] = c.check(ctx, work.target)
			}
		}()
	}

	for index, target := range targets {
		select {
		case jobs <- job{index: index, target: target}:
		case <-ctx.Done():
			close(jobs)
			group.Wait()
			return results
		}
	}
	close(jobs)
	group.Wait()
	return results
}

func (c *Checker) check(ctx context.Context, target Target) Result {
	started := time.Now()
	result := Result{Target: target, CheckedAt: started.UTC()}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.URL, nil)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	request.Header.Set("User-Agent", "GoHealthMonitor/1.0 (+https://github.com/JohnBieniek/GoHealthMonitor)")
	response, err := c.client.Do(request)
	result.LatencyMS = time.Since(started).Milliseconds()
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4<<10))
	result.StatusCode = response.StatusCode
	result.Healthy = response.StatusCode >= 200 && response.StatusCode < 400
	return result
}
