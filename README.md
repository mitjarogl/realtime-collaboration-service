# Realtime collaboration service

Realtime collaboration service is a event based implementation for tracking and locking fields when multiple users are working on same resources.

Events methods are written for general use.
API is written in NestJS & Socket.IO.

This project is still under development and is currently experimental.


## Installation

```bash
$ npm install
```

or

```bash
$ yarn
```

## Prerequisites

To use local Redis instance you need to create Docker image with this command `docker build -t "redis:dev" .`.
Check with `docker images` to get a `IMAGE_ID`.
When image is created run this command `docker create --name redis-container <IMAGE_ID>`, this will create Redis container.
When it is finished run `docker start redis-container`.
Check with `docker ps -a` if instance is running.
There is also shorthand to create and start instance at same time.
Run command `docker run -d -p 6379:6379 --name redis-container IMAGE_ID`. Local Redis is accessible at `redis://localhost:6379`.

## Running the app

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## TODO
 - Implement PoC client implementation.
 - Write docs for usage.

## License

[MIT licensed](LICENSE)
