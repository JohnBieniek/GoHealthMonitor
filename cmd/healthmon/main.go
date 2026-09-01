package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/JohnBieniek/GoHealthMonitor/internal/monitor"
)

func main() {
	configPath := flag.String("config", "config/targets.json", "path to target configuration")
	workers := flag.Int("workers", 8, "maximum concurrent checks")
	timeout := flag.Duration("timeout", 8*time.Second, "timeout per target")
	flag.Parse()

	file, err := os.Open(*configPath)
	if err != nil {
		slog.Error("open target configuration", "error", err)
		os.Exit(1)
	}
	defer file.Close()
	targets, err := monitor.LoadTargets(file)
	if err != nil {
		slog.Error("load target configuration", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	started := time.Now()
	results := monitor.NewChecker(*workers, *timeout).CheckAll(ctx, targets)
	if err := json.NewEncoder(os.Stdout).Encode(struct {
		CheckedAt   time.Time        `json:"checkedAt"`
		Duration    string           `json:"duration"`
		TargetCount int              `json:"targetCount"`
		Results     []monitor.Result `json:"results"`
	}{time.Now().UTC(), time.Since(started).Round(time.Millisecond).String(), len(results), results}); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
