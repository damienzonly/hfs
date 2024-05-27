# HFS 3

## Run container
```bash
docker run -d -p 8080:80 -e ADMIN_PASSWORD=password -v ./hfs_data:/app/hfs_data -v ./local_disk:/mnt/whatever rejetto/hfs:0.52.7
```

## With docker compose

Create a `docker-compose.yaml` using the following template

```yaml
version: '3'

services:
  hfs:
    image: hfs
    volumes:
      - ./hfs_data:/app/hfs_data # for hfs conf persistence
      - ./user_data:/mnt/abc # for your files
      # don't forget to share volumes to access certificate files
    environment:
      - HTTP_PORT=8000 # default is 80
      - HTTPS_PORT=8001 # optional
      - ADMIN_PASSWORD=password # optional, but allows for automatic admin user creation
      - CERT=/path/to/cert # optional
      - PRIVATE_KEY=/path/to/pkey # optional
    ports:
      - 9000:8001
```
