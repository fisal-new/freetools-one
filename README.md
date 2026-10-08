# freetools.one

The site as it actually runs. Static front end, served by `freetools-rs`, behind
nginx with a Let's Encrypt certificate.

## Layout

```
index.html      the landing page: the Hub, the Spy, a copy button each
index.css       the whole stylesheet, no framework
favicon.ico     served because the pages link it
```

The key service is not here. It is its own repository,
[`drakthon-key-system`](https://github.com/fisal-new/drakthon-key-system), and it
lives at `/k/` on the same domain.

## Serving

`freetools-rs --port 8090 --www ./www`, with nginx terminating TLS and
proxying. One extra location for the key service:

```nginx
location /k/ {
    proxy_pass http://127.0.0.1:8091/k/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 64k;
}
```

## Pages

| path | what |
|---|---|
| `/` | the scripts page |
| `/k/loader.lua` | the key loader, public |
| `/k/key?k=&d=` | shows a key, its device and its expiry |
| `/k/get/NAME?t=&d=&p=&u=` | a protected script, or 403 |

## Why the copy buttons use `game:HttpGet`

The Hub and the Spy are protected artifacts. The paste lines fetch them and run
them in one call, which is the form every executor accepts, including the ones
that will not take a reader function.

## Notes

- The ad slot in `index.html` is an empty, visibly labelled container. Ad code
  goes inside it, inside the label, so it never reads as part of the download.
- `loader.lua` is public on purpose. It holds no secret, only where to ask, and
  gating it meant nobody could start.
- The two scripts behind `/k/get/` are device bound and session bound. See the
  key service repository for how that is enforced.
