#!/usr/bin/env python3
"""
Update the Daedalus app catalog stored in MinIO.

Usage:
    python update-catalog.py add --id APP_ID --name "App Name" --icon "🎯" --description "Description" --path "/apps/app-id/index.html"
    python update-catalog.py remove --id APP_ID
    python update-catalog.py list
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from io import BytesIO

try:
    from minio import Minio
except ImportError:
    print("Error: minio package not installed. Run: pip install minio")
    sys.exit(1)

# MinIO configuration
MINIO_ENDPOINT = "minio.wheelbase.io"
MINIO_ACCESS_KEY = "wheelbase-admin"
MINIO_SECRET_KEY = "uDtIQzNGC8bIdTOhiTHy60an"
MINIO_BUCKET = "daedalus"
CATALOG_FILE = "catalog.json"


def get_client():
    """Create MinIO client."""
    return Minio(
        MINIO_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=True,
    )


def load_catalog(client):
    """Load catalog from MinIO."""
    try:
        response = client.get_object(MINIO_BUCKET, CATALOG_FILE)
        data = json.loads(response.read().decode('utf-8'))
        response.close()
        response.release_conn()
        return data
    except Exception:
        # Return empty catalog if doesn't exist
        return {"apps": []}


def save_catalog(client, catalog):
    """Save catalog to MinIO."""
    data = json.dumps(catalog, indent=2).encode('utf-8')
    client.put_object(
        MINIO_BUCKET,
        CATALOG_FILE,
        BytesIO(data),
        length=len(data),
        content_type="application/json",
    )


def add_app(client, app_id, name, icon, description, path, featured=False):
    """Add or update an app in the catalog."""
    catalog = load_catalog(client)
    
    # Check if app already exists
    existing_idx = None
    for idx, app in enumerate(catalog["apps"]):
        if app["id"] == app_id:
            existing_idx = idx
            break
    
    app_entry = {
        "id": app_id,
        "name": name,
        "icon": icon,
        "description": description,
        "path": path,
        "featured": featured,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    
    if existing_idx is not None:
        # Preserve original created_at if updating
        app_entry["created_at"] = catalog["apps"][existing_idx].get("created_at", app_entry["created_at"])
        app_entry["updated_at"] = datetime.now(timezone.utc).isoformat()
        catalog["apps"][existing_idx] = app_entry
        action = "Updated"
    else:
        catalog["apps"].append(app_entry)
        action = "Added"
    
    save_catalog(client, catalog)
    print(f"{action} app: {name} ({app_id})")
    return True


def remove_app(client, app_id):
    """Remove an app from the catalog."""
    catalog = load_catalog(client)
    
    original_count = len(catalog["apps"])
    catalog["apps"] = [app for app in catalog["apps"] if app["id"] != app_id]
    
    if len(catalog["apps"]) < original_count:
        save_catalog(client, catalog)
        print(f"Removed app: {app_id}")
        return True
    else:
        print(f"App not found: {app_id}")
        return False


def list_apps(client):
    """List all apps in the catalog."""
    catalog = load_catalog(client)
    
    if not catalog["apps"]:
        print("Catalog is empty")
        return
    
    print(f"\n{'ID':<20} {'Icon':<4} {'Name':<25} {'Path'}")
    print("-" * 80)
    
    for app in sorted(catalog["apps"], key=lambda x: x.get("created_at", "")):
        print(f"{app['id']:<20} {app.get('icon', '?'):<4} {app['name']:<25} {app['path']}")
    
    print(f"\nTotal: {len(catalog['apps'])} apps")


def main():
    parser = argparse.ArgumentParser(description="Manage Daedalus app catalog")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")
    
    # Add command
    add_parser = subparsers.add_parser("add", help="Add or update an app")
    add_parser.add_argument("--id", required=True, help="App ID (lowercase, alphanumeric, hyphens)")
    add_parser.add_argument("--name", required=True, help="Display name")
    add_parser.add_argument("--icon", required=True, help="Emoji icon")
    add_parser.add_argument("--description", required=True, help="Short description")
    add_parser.add_argument("--path", required=True, help="Path to index.html (e.g., /apps/my-app/index.html)")
    add_parser.add_argument("--featured", action="store_true", help="Mark as featured")
    
    # Remove command
    remove_parser = subparsers.add_parser("remove", help="Remove an app")
    remove_parser.add_argument("--id", required=True, help="App ID to remove")
    
    # List command
    subparsers.add_parser("list", help="List all apps")
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        sys.exit(1)
    
    client = get_client()
    
    if args.command == "add":
        add_app(
            client,
            args.id,
            args.name,
            args.icon,
            args.description,
            args.path,
            args.featured,
        )
    elif args.command == "remove":
        remove_app(client, args.id)
    elif args.command == "list":
        list_apps(client)


if __name__ == "__main__":
    main()
