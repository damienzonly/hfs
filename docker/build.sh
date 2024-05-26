version=${VERSION:-0.52.7}

cd ..
docker system prune -f
docker rmi hfs
docker system prune -f
docker build --build-arg="VERSION=$version" --no-cache -t rejetto/hfs:$version -f docker/Dockerfile .