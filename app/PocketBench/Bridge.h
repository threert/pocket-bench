// The room's renderer (core/src/lib.rs).
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct BenchHost BenchHost;

BenchHost *bench_create(void *metal_layer, uint32_t width, uint32_t height, float scale, const char *bundle, const char *assets, const char *presets);
void bench_resize(BenchHost *host, uint32_t width, uint32_t height, float scale);
void bench_pointer(BenchHost *host, float u, float v);
void bench_button(BenchHost *host, uint8_t button, bool down);
void bench_wheel(BenchHost *host, float notches);
void bench_key(BenchHost *host, const char *code, const char *name, bool down);
void bench_send(BenchHost *host, const char *json);
char *bench_poll(BenchHost *host);
void bench_free(char *text);
void bench_stream(BenchHost *host, const char *name, uint32_t width, uint32_t height, const uint8_t *rgba, size_t len);
void bench_snapshot(BenchHost *host, const char *path);
void bench_reload(BenchHost *host, const char *bundle);
void bench_quality(BenchHost *host, uint32_t fps, float scale, uint32_t bounces);
void bench_destroy(BenchHost *host);
