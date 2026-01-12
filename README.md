# Asterisk Docker

A lightweight Docker image for Asterisk PBX server, built using a multi-stage build for minimal image size. Tested for Asterisk v18 and v22.

## Build

```bash
docker build -t asterisk:18 .
```

Or build version 22:

```bash
docker build -f Dockerfile.22 -t asterisk:22 .
```

## Run

### Quick Test (Interactive)

Run Asterisk in the foreground with verbose output:

```bash
docker run -it --rm --name asterisk18 asterisk:18
```

### Production (Detached)

Run with standard Asterisk ports exposed:

```bash
docker run -d --name asterisk18 \
  -p 5060:5060/udp \
  -p 5060:5060/tcp \
  -p 10000-10100:10000-10100/udp \
  -p 5038:5038/tcp \
  -p 8088:8088/tcp \
  asterisk:18
```

### Connect to Asterisk CLI

Once Asterisk is running in detached mode, connect to the CLI:

```bash
docker exec -it asterisk18 asterisk -rvvvvvvvvv
```

### Shell Access

To get a bash shell inside the container:

```bash
docker run -it --rm --name asterisk18 --entrypoint /bin/bash asterisk:18
```

From within the shell, start Asterisk and connect to the CLI:

```bash
asterisk &
asterisk -rvvvvvvvvv
```

## Ports

| Port        | Protocol | Description                      |
| ----------- | -------- | -------------------------------- |
| 5060        | UDP/TCP  | SIP signaling                    |
| 10000-10100 | UDP      | RTP media (audio)                |
| 5038        | TCP      | AMI (Asterisk Manager Interface) |
| 8088        | TCP      | HTTP interface                   |

## Testing

### SIP Registration Test

Use `sip-register-test.js` to verify the Asterisk container is accepting SIP connections:

```bash
node sip-register-test.js --host localhost --port 5060 --user 1001 --pass secret
```

Options:

- `--host` - Asterisk server hostname/IP (default: localhost)
- `--port` - SIP port (default: 5060)
- `--user` - SIP username (default: 1001)
- `--pass` - SIP password
- `--domain` - SIP domain (default: same as host)

Works with either node or bun.

### WebSocket Testing (Pending)

The `sip-test.html` file provides a browser-based WebSocket SIP client for testing. This requires WebSocket support to be configured in the Asterisk container, which is not yet implemented.
