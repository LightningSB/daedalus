package storage

import (
	"context"
	"fmt"
	"io"
	"time"

	"daedalus-proxy/internal/config"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type MinIOClient struct {
	client *minio.Client
	bucket string
}

func NewMinIOClient(cfg *config.Config) (*MinIOClient, error) {
	client, err := minio.New(cfg.MinioEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.MinioAccessKey, cfg.MinioSecretKey, ""),
		Secure: cfg.MinioUseSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create MinIO client: %w", err)
	}

	// Check if bucket exists, create if not
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	exists, err := client.BucketExists(ctx, cfg.MinioBucket)
	if err != nil {
		return nil, fmt.Errorf("failed to check bucket existence: %w", err)
	}

	if !exists {
		err = client.MakeBucket(ctx, cfg.MinioBucket, minio.MakeBucketOptions{})
		if err != nil {
			return nil, fmt.Errorf("failed to create bucket: %w", err)
		}
	}

	return &MinIOClient{
		client: client,
		bucket: cfg.MinioBucket,
	}, nil
}

func (m *MinIOClient) GetObject(ctx context.Context, objectName string) (io.Reader, error) {
	obj, err := m.client.GetObject(ctx, m.bucket, objectName, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	return obj, nil
}

func (m *MinIOClient) PutObject(ctx context.Context, objectName string, reader io.Reader, size int64) error {
	_, err := m.client.PutObject(ctx, m.bucket, objectName, reader, size, minio.PutObjectOptions{
		ContentType: "application/octet-stream",
	})
	return err
}

func (m *MinIOClient) ObjectExists(ctx context.Context, objectName string) (bool, error) {
	_, err := m.client.StatObject(ctx, m.bucket, objectName, minio.StatObjectOptions{})
	if err != nil {
		errResponse, ok := err.(minio.ErrorResponse)
		if ok && errResponse.Code == "NoSuchKey" {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (m *MinIOClient) DeleteObject(ctx context.Context, objectName string) error {
	return m.client.RemoveObject(ctx, m.bucket, objectName, minio.RemoveObjectOptions{})
}