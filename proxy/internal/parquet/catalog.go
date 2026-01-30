package parquet

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"

	"daedalus-proxy/internal/storage"
)

type CatalogItem struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Icon        string `json:"icon"`
	Description string `json:"description"`
	Path        string `json:"path"`
	CreatedAt   int64  `json:"created_at"`
	Featured    bool   `json:"featured"`
}

func ReadCatalog(ctx context.Context, minioClient *storage.MinIOClient) ([]CatalogItem, error) {
	exists, err := minioClient.ObjectExists(ctx, "catalog.json")
	if err != nil {
		return nil, fmt.Errorf("failed to check catalog existence: %w", err)
	}

	if !exists {
		// Return default catalog
		return []CatalogItem{
			{
				ID:          "vin-decoder",
				Name:        "VIN Decoder",
				Icon:        "🚗",
				Description: "Decode any VIN instantly with full vehicle specs",
				Path:        "/apps/vin-decoder/index.html",
				Featured:    true,
			},
		}, nil
	}

	reader, err := minioClient.GetObject(ctx, "catalog.json")
	if err != nil {
		return nil, fmt.Errorf("failed to get catalog object: %w", err)
	}
	defer func() {
		if closer, ok := reader.(io.Closer); ok {
			closer.Close()
		}
	}()

	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("failed to read catalog data: %w", err)
	}

	var items []CatalogItem
	err = json.Unmarshal(data, &items)
	if err != nil {
		return nil, fmt.Errorf("failed to parse catalog json: %w", err)
	}

	return items, nil
}

func WriteCatalog(ctx context.Context, minioClient *storage.MinIOClient, items []CatalogItem) error {
	data, err := json.Marshal(items)
	if err != nil {
		return fmt.Errorf("failed to marshal catalog: %w", err)
	}

	return minioClient.PutObject(ctx, "catalog.json", bytes.NewReader(data), int64(len(data)))
}
