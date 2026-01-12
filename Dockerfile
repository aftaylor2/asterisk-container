# Multi-stage build for smaller final image
ARG ASTERISK_VERSION=18

# Build stage
FROM ubuntu:24.04 AS builder

ARG ASTERISK_VERSION

LABEL org.opencontainers.image.authors=aftaylor2@gmail.com
LABEL org.opencontainers.image.title="Asterisk"
LABEL org.opencontainers.image.description="Asterisk PBX Server for Docker and Kubernetes"
LABEL org.opencontainers.image.version="${ASTERISK_VERSION}"
LABEL org.opencontainers.image.licenses=UNLICENSED

ENV DEBIAN_FRONTEND=noninteractive \
  ASTERISK_VERSION=${ASTERISK_VERSION}

# Install build dependencies
RUN apt-get update && apt-get -y upgrade && \
  apt-get install -y \
  git \
  curl \
  wget \
  libnewt-dev \
  libssl-dev \
  libncurses5-dev \
  subversion \
  libsqlite3-dev \
  build-essential \
  libjansson-dev \
  libxml2-dev \
  uuid-dev \
  libsnmp-dev \
  libedit-dev \
  && rm -rf /var/lib/apt/lists/*

# Download and compile Asterisk
RUN cd /tmp && \
  git clone -b ${ASTERISK_VERSION} --depth 1 https://github.com/asterisk/asterisk.git asterisk-${ASTERISK_VERSION} && \
  cd asterisk-${ASTERISK_VERSION} && \
  # Configure
  ./configure --libdir=/usr/lib64 --with-jansson-bundled 1> /dev/null && \
  # Configure build options
  make -j$(nproc) menuselect.makeopts && \
  menuselect/menuselect \
  --disable BUILD_NATIVE \
  --enable cdr_csv \
  --enable chan_sip \
  --enable res_snmp \
  --enable res_http_websocket \
  menuselect.makeopts && \
  # Build and install
  make -j$(nproc) 1> /dev/null && \
  make -j$(nproc) install 1> /dev/null && \
  make -j$(nproc) samples 1> /dev/null && \
  # Configure safe_asterisk
  sed -i -e 's/# MAXFILES=/MAXFILES=/' /usr/sbin/safe_asterisk && \
  sed -i 's/TTY=9/TTY=/g' /usr/sbin/safe_asterisk && \
  # Cleanup build directory
  cd / && rm -rf /tmp/asterisk-${ASTERISK_VERSION}

# Runtime stage
FROM ubuntu:24.04

ARG ASTERISK_VERSION

LABEL org.opencontainers.image.authors=aftaylor2@gmail.com
LABEL org.opencontainers.image.title="Asterisk"
LABEL org.opencontainers.image.description="Asterisk PBX Server for Docker and Kubernetes"
LABEL org.opencontainers.image.version="${ASTERISK_VERSION}"
LABEL org.opencontainers.image.licenses=UNLICENSED

ENV DEBIAN_FRONTEND=noninteractive \
  LD_LIBRARY_PATH=/usr/lib64

# Install runtime dependencies only
RUN apt-get update && \
  apt-get install -y \
  libnewt0.52 \
  libssl3 \
  libncurses6 \
  libsqlite3-0 \
  libjansson4 \
  libxml2 \
  uuid-runtime \
  libsnmp40 \
  libedit2 \
  && rm -rf /var/lib/apt/lists/* && \
  # Create asterisk user
  useradd -r -m -d /var/lib/asterisk -s /sbin/nologin asterisk

# Copy Asterisk from builder
COPY --from=builder /usr/sbin/asterisk /usr/sbin/
COPY --from=builder /usr/sbin/safe_asterisk /usr/sbin/
COPY --from=builder /usr/sbin/astgenkey /usr/sbin/
COPY --from=builder /usr/sbin/astcanary /usr/sbin/
COPY --from=builder /usr/lib64/asterisk /usr/lib64/asterisk
COPY --from=builder /usr/lib64/libasterisk* /usr/lib64/
COPY --from=builder /var/lib/asterisk /var/lib/asterisk
COPY --from=builder /etc/asterisk /etc/asterisk

# Create necessary directories and set permissions
RUN mkdir -p /var/run/asterisk \
  /var/log/asterisk \
  /var/spool/asterisk && \
  chown -R asterisk:asterisk \
  /var/run/asterisk \
  /etc/asterisk \
  /var/lib/asterisk \
  /var/log/asterisk \
  /var/spool/asterisk \
  /usr/lib64/asterisk

# Expose standard Asterisk ports
# SIP
EXPOSE 5060/udp 5060/tcp
# RTP ports range (adjust as needed for your configuration)
EXPOSE 10000-10100/udp
# AMI (Asterisk Manager Interface)
EXPOSE 5038/tcp
# HTTP/HTTPS for web interface
EXPOSE 8088/tcp 8089/tcp

# Declare volumes for Kubernetes ConfigMap/Secret mounting
# VOLUME ["/etc/asterisk", "/var/lib/asterisk", "/var/log/asterisk", "/var/spool/asterisk"]

# Switch to asterisk user
USER asterisk

# Healthcheck to ensure Asterisk is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD asterisk -rx "core show version" || exit 1

# Use ENTRYPOINT with exec form for proper signal handling
ENTRYPOINT ["/usr/sbin/asterisk"]
CMD ["-fvvvvv"]
