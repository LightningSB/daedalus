package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port          string
	MinioEndpoint string
	MinioAccessKey string
	MinioSecretKey string
	MinioBucket   string
	MinioUseSSL   bool
}

func Load() *Config {
	useSSL, _ := strconv.ParseBool(getEnv("MINIO_USE_SSL", "true"))
	
	return &Config{
		Port:           getEnv("PORT", "8080"),
		MinioEndpoint:  getEnv("MINIO_ENDPOINT", "minio.wheelbase.io"),
		MinioAccessKey: getEnv("MINIO_ACCESS_KEY", ""),
		MinioSecretKey: getEnv("MINIO_SECRET_KEY", ""),
		MinioBucket:    getEnv("MINIO_BUCKET", "daedalus"),
		MinioUseSSL:    useSSL,
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}