package parquet

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"

	"daedalus-proxy/internal/storage"
	"github.com/xitongsys/parquet-go/parquet"
	"github.com/xitongsys/parquet-go/source"
	"github.com/xitongsys/parquet-go/writer"
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

// ParquetVINRecord is the Parquet-compatible version with proper tags
type ParquetVINRecord struct {
	VIN       string `parquet:"name=vin, type=BYTE_ARRAY, convertedtype=UTF8"`
	DecodedAt int64  `parquet:"name=decoded_at, type=INT64"`
	Make      string `parquet:"name=make, type=BYTE_ARRAY, convertedtype=UTF8"`
	Model     string `parquet:"name=model, type=BYTE_ARRAY, convertedtype=UTF8"`
	Year      int32  `parquet:"name=year, type=INT32"`
	Thumbnail string `parquet:"name=thumbnail, type=BYTE_ARRAY, convertedtype=UTF8"`
	Data      string `parquet:"name=data, type=BYTE_ARRAY, convertedtype=UTF8"`
}

func getJSONPath(tgUserID string) string {
	return fmt.Sprintf("users/%s/vin-history.json", tgUserID)
}

func getParquetPath(tgUserID string) string {
	return fmt.Sprintf("users/%s/vin-history.parquet", tgUserID)
}

func ReadVINHistory(ctx context.Context, minioClient *storage.MinIOClient, tgUserID string) ([]VINHistoryRecord, error) {
	objectName := getJSONPath(tgUserID)

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

	// Write JSON back
	if err := writeJSONHistory(ctx, minioClient, tgUserID, records); err != nil {
		return err
	}

	// Generate Parquet file for DuckDB
	if err := writeParquetHistory(ctx, minioClient, tgUserID, records); err != nil {
		// Log error but don't fail the operation
		fmt.Printf("Warning: failed to write parquet history: %v\n", err)
	}

	return nil
}

func writeJSONHistory(ctx context.Context, minioClient *storage.MinIOClient, tgUserID string, records []VINHistoryRecord) error {
	objectName := getJSONPath(tgUserID)
	data, err := json.Marshal(records)
	if err != nil {
		return fmt.Errorf("failed to marshal history: %w", err)
	}

	return minioClient.PutObject(ctx, objectName, bytes.NewReader(data), int64(len(data)))
}

func writeParquetHistory(ctx context.Context, minioClient *storage.MinIOClient, tgUserID string, records []VINHistoryRecord) error {
	objectName := getParquetPath(tgUserID)

	// Convert to Parquet-compatible records
	parquetRecords := make([]ParquetVINRecord, len(records))
	for i, r := range records {
		dataStr := ""
		if r.Data != nil {
			dataStr = string(r.Data)
		}
		parquetRecords[i] = ParquetVINRecord{
			VIN:       r.VIN,
			DecodedAt: r.DecodedAt,
			Make:      r.Make,
			Model:     r.Model,
			Year:      r.Year,
			Thumbnail: r.Thumbnail,
			Data:      dataStr,
		}
	}

	// Create in-memory buffer
	var buf bytes.Buffer

	// Create Parquet writer
	pw, err := writer.NewParquetWriter(&buf, new(ParquetVINRecord), 4)
	if err != nil {
		return fmt.Errorf("failed to create parquet writer: %w", err)
	}

	// Set compression
	pw.CompressionType = parquet.CompressionCodec_SNAPPY

	// Write records
	for _, record := range parquetRecords {
		if err := pw.Write(record); err != nil {
			return fmt.Errorf("failed to write parquet record: %w", err)
		}
	}

	// Close writer
	if err := pw.WriteStop(); err != nil {
		return fmt.Errorf("failed to stop parquet writer: %w", err)
	}

	// Upload to MinIO
	return minioClient.PutObject(ctx, objectName, bytes.NewReader(buf.Bytes()), int64(buf.Len()))
}

// GetParquetFile returns the Parquet file for DuckDB to read directly
func GetParquetFile(ctx context.Context, minioClient *storage.MinIOClient, tgUserID string) (io.ReadCloser, error) {
	objectName := getParquetPath(tgUserID)
	
	exists, err := minioClient.ObjectExists(ctx, objectName)
	if err != nil {
		return nil, fmt.Errorf("failed to check parquet existence: %w", err)
	}

	if !exists {
		// Generate parquet from JSON if it doesn't exist
		records, err := ReadVINHistory(ctx, minioClient, tgUserID)
		if err != nil {
			return nil, err
		}
		if len(records) == 0 {
			return nil, fmt.Errorf("no history found")
		}
		if err := writeParquetHistory(ctx, minioClient, tgUserID, records); err != nil {
			return nil, err
		}
	}

	return minioClient.GetObject(ctx, objectName)
}

// InMemorySource wraps a bytes.Buffer to implement source.ParquetFile
type InMemorySource struct {
	buf *bytes.Buffer
	sz  int64
}

func NewInMemorySource(buf *bytes.Buffer) *InMemorySource {
	return &InMemorySource{
		buf: buf,
		sz:  int64(buf.Len()),
	}
}

func (s *InMemorySource) Create(_ string) (source.ParquetFile, error) {
	return nil, fmt.Errorf("not implemented")
}

func (s *InMemorySource) Open(_ string) (source.ParquetFile, error) {
	return s, nil
}

func (s *InMemorySource) Seek(offset int64, whence int) (int64, error) {
	// Not efficient but works for small files
	return 0, nil
}

func (s *InMemorySource) Read(p []byte) (n int, err error) {
	return s.buf.Read(p)
}

func (s *InMemorySource) Write(p []byte) (n int, err error) {
	return s.buf.Write(p)
}

func (s *InMemorySource) Close() error {
	return nil
}

func (s *InMemorySource) ReadAt(p []byte, off int64) (n int, err error) {
	data := s.buf.Bytes()
	if off >= int64(len(data)) {
		return 0, io.EOF
	}
	n = copy(p, data[off:])
	if n < len(p) {
		return n, io.EOF
	}
	return n, nil
}

func (s *InMemorySource) WriteString(str string) (n int, err error) {
	return s.buf.WriteString(str)
}

func (s *InMemorySource) WriteStringAt(str string, off int64) (n int, err error) {
	return 0, fmt.Errorf("not implemented")
}

func (s *InMemorySource) Name() string {
	return "in-memory"
}

func (s *InMemorySource) Size() int64 {
	return s.sz
}
