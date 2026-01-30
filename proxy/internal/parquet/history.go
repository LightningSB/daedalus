package parquet

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"

	"daedalus-proxy/internal/storage"
	"github.com/parquet-go/parquet-go"
)

type VINHistoryRecord struct {
	VIN       string `parquet:"vin"`
	DecodedAt int64  `parquet:"decoded_at"`
	Make      string `parquet:"make"`
	Model     string `parquet:"model"`
	Year      int32  `parquet:"year"`
	Thumbnail string `parquet:"thumbnail"`
	DataJSON  string `parquet:"data_json"`
}

type VINHistoryResponse struct {
	VIN       string          `json:"vin"`
	DecodedAt int64           `json:"decoded_at"`
	Make      string          `json:"make"`
	Model     string          `json:"model"`
	Year      int32           `json:"year"`
	Thumbnail string          `json:"thumbnail"`
	Data      json.RawMessage `json:"data"`
}

func ReadVINHistory(ctx context.Context, minioClient *storage.MinIOClient, tgUserID string) ([]VINHistoryResponse, error) {
	objectName := fmt.Sprintf("users/%s/vin-history.parquet", tgUserID)
	
	exists, err := minioClient.ObjectExists(ctx, objectName)
	if err != nil {
		return nil, fmt.Errorf("failed to check history existence: %w", err)
	}

	if !exists {
		return []VINHistoryResponse{}, nil
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

	records := []VINHistoryRecord{}
	err = parquet.Read(bytes.NewReader(data), &records)
	if err != nil {
		return nil, fmt.Errorf("failed to parse history parquet: %w", err)
	}

	// Convert records to response format
	responses := make([]VINHistoryResponse, len(records))
	for i, record := range records {
		responses[i] = VINHistoryResponse{
			VIN:       record.VIN,
			DecodedAt: record.DecodedAt,
			Make:      record.Make,
			Model:     record.Model,
			Year:      record.Year,
			Thumbnail: record.Thumbnail,
			Data:      json.RawMessage(record.DataJSON),
		}
	}

	return responses, nil
}

func AppendVINHistory(ctx context.Context, minioClient *storage.MinIOClient, tgUserID string, newRecord VINHistoryRecord) error {
	objectName := fmt.Sprintf("users/%s/vin-history.parquet", tgUserID)
	
	// Read existing records
	exists, err := minioClient.ObjectExists(ctx, objectName)
	if err != nil {
		return fmt.Errorf("failed to check history existence: %w", err)
	}

	records := []VINHistoryRecord{}
	if exists {
		reader, err := minioClient.GetObject(ctx, objectName)
		if err != nil {
			return fmt.Errorf("failed to get history object: %w", err)
		}
		
		data, err := io.ReadAll(reader)
		if closer, ok := reader.(io.Closer); ok {
			closer.Close()
		}
		if err != nil {
			return fmt.Errorf("failed to read history data: %w", err)
		}

		err = parquet.Read(bytes.NewReader(data), &records)
		if err != nil {
			return fmt.Errorf("failed to parse history parquet: %w", err)
		}
	}

	// Append new record
	records = append(records, newRecord)

	// Write back
	buf := new(bytes.Buffer)
	err = parquet.Write(buf, records)
	if err != nil {
		return fmt.Errorf("failed to write history parquet: %w", err)
	}

	return minioClient.PutObject(ctx, objectName, bytes.NewReader(buf.Bytes()), int64(buf.Len()))
}