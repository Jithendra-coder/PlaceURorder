FROM postgres:16-alpine

ARG PGVECTOR_VERSION=0.8.7

RUN apk add --no-cache --virtual .build-deps build-base git llvm21-dev clang21 \
    && git clone --depth 1 --branch "v${PGVECTOR_VERSION}" https://github.com/pgvector/pgvector.git /tmp/pgvector \
    && make -C /tmp/pgvector OPTFLAGS="" CLANG=clang-21 LLVM_CONFIG=/usr/lib/llvm21/bin/llvm-config \
    && make -C /tmp/pgvector install OPTFLAGS="" CLANG=clang-21 LLVM_CONFIG=/usr/lib/llvm21/bin/llvm-config \
    && rm -rf /tmp/pgvector \
    && apk del .build-deps
