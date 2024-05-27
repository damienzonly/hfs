version=${VERSION:-0.52.7}

cd ..
docker system prune -f
docker rmi hfs
docker system prune -f
docker buildx create --name bld --use
docker buildx inspect bld --bootstrap
docker buildx build \
    --build-arg VERSION="$version" \
    --platform linux/amd64,linux/arm64 \
    -t rejetto/hfs:$version \
    -t rejetto/hfs:latest \
    -f docker/Dockerfile \
    --push \
    .
docker buildx rm bld

