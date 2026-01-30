package parquet

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"time"

	"daedalus-proxy/internal/storage"
	"github.com/parquet-go/parquet-go"
)

type CatalogItem struct {
	ID          string    `parquet:"id"`
	Name        string    `parquet:"name"`
	Icon        string    `parquet:"icon"`
	Description string    `parquet:"description"`
	Path        string    `parquet:"path"`
	CreatedAt   int64     `parquet:"created_at,timestamp(millis)"`
	Featured    bool      `parquet:"featured"`
}

func ReadCatalog(ctx context.Context, minioClient *storage.MinIOClient) ([]CatalogItem, error) {
	exists, err := minioClient.ObjectExists(ctx, "catalog.parquet")
	if err != nil {
		return nil, fmt.Errorf("failed to check catalog existence: %w", err)
	}

	if !exists {
		return []CatalogItem{}, nil
	}

	reader, err := minioClient.GetObject(ctx, "catalog.parquet")
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

	items := []CatalogItem{}
	err = parquet.Read(bytes.NewReader(data), &items)
	if err != nil {
		return nil, fmt.Errorf("failed to parse catalog parquet: %w", err)
	}

	return items, nil
}

func WriteCatalog(ctx context.Context, minioClient *storage.MinIOClient, items []CatalogItem) error {
	buf := new(bytes.Buffer)
	err := parquet.Write(buf, items)
	if err != nil {
		return fmt.Errorf("failed to write catalog parquet: %w", err)
	}

	return minioClient.PutObject(ctx, "catalog.parquet", bytes.NewReader(buf.Bytes()), int64(buf.Len()))
}