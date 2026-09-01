package monitor

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLoadTargetsRejectsUnsafeURL(t *testing.T) {
	_, err := LoadTargets(strings.NewReader(`[{"id":"x","name":"X","url":"http://example.com"}]`))
	if err == nil {
		t.Fatal("expected HTTP URL to be rejected")
	}
}

func TestCheckAllPreservesOrderAndReportsHealth(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/down" {
			response.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		response.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	checker := NewChecker(2, time.Second)
	checker.client = server.Client()
	targets := []Target{
		{ID: "up", Name: "Up", URL: server.URL + "/up"},
		{ID: "down", Name: "Down", URL: server.URL + "/down"},
	}
	results := checker.CheckAll(context.Background(), targets)
	if len(results) != 2 || results[0].ID != "up" || !results[0].Healthy {
		t.Fatalf("unexpected healthy result: %#v", results)
	}
	if results[1].ID != "down" || results[1].Healthy || results[1].StatusCode != 503 {
		t.Fatalf("unexpected unhealthy result: %#v", results)
	}
}
