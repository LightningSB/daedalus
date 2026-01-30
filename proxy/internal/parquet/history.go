package parquet

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"

	"daedalus-proxy/internal/storage"
)

type VINHistoryRecord struct {
	VIN       string          `json:"vin"`
	DecodedAt int64           `json:"decoded_at"`
	Make      string          `json:"make"`
	Model     string          `json:"model"`
	Year      int32           `json:"year"`
	Thumbnail string          `json:"thumbnail"`
	Data      json.RawMessage `json:"data"`
}

func ReadVINHistory(ctx context.Context, minioClient *storage.MinIOClient, tgUserID string) ([]VINHistoryRecord, error) {
	objectName := fmt.Sprintf("users/%s/vin-history.json", tgUserID)

	exists, err := minioClient.ObjectExists(ctx, objectName)
	if err != nil {
		return nil, fmt.Errorf("failed to check history existence: %w", err)
	}

	if !exists {
		return []VINHistoryRecord{}, nil
	}

	reader, err := minioClient.GetObject(ctx, objectName)
	if err != nil {
		return nil, fmt.Errorf("failed to get history object: %w", err)
	}
	defer func() {
		if closer, ok := reader.(io.Closer); ok {
			closer.Close()
		}
	}()

	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("failed to read history data: %w", err)
	}

	var records []VINHistoryRecord
	err = json.Unmarshal(data, &records)
	if err != nil {
		return nil, fmt.Errorf("failed to parse history json: %w", err)
	}

	return records, nil
}

func AppendVINHistory(ctx context.Context, minioClient *storage.MinIOClient, tgUserID string, newRecord VINHistoryRecord) error {
	objectName := fmt.Sprintf("users/%s/vin-history.json", tgUserID)

	// Read existing records
	records, err := ReadVINHistory(ctx, minioClient, tgUserID)
	if err != nil {
		// If error reading, start fresh
		records = []VINHistoryRecord{}
	}

	// Prepend new record
	records = append([]VINHistoryRecord{newRecord}, records...)

	// Keep only last 50 records
	if len(records) > 50 {
		records = records[:50]
	}

	// Write back
	data, err := json.Marshal(records)
	if err != nil {
		return fmt.Errorf("failed to marshal history: %w", err)
	}

	return minioClient.PutObject(ctx, objectName, bytes.NewReader(data), int64(len(data)))
}
