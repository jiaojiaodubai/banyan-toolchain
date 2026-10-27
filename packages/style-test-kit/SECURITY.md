# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
vulnerability reporting for this repository:

<https://github.com/jiaojiaodubai/banyan-style-test-kit/security/advisories/new>

Include the affected version/commit, a minimal reproduction, and the impact.
We will acknowledge the report and coordinate a fix and disclosure.

## Running untrusted styles

`node:vm` is a **correctness** boundary, not a security boundary. It isolates
prototypes, not CPU, memory or the event loop. The default in-process runner is
intended for local, trusted styles.

For AI-generated or third-party styles, use the isolated runner:

```sh
pnpm cli run --isolated --timeout 10000 --memory 256 --max-output 4194304 ...
```

The child process has a wall-clock limit, a V8 heap limit, an output-size limit,
and the same read-only `--style-dir` file capability. It does not provide a
syscall sandbox: if you need stronger isolation, run the toolkit in a container
or VM. See [docs/security.md](docs/security.md) for the full boundary.
