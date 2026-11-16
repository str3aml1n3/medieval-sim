// Renders a Gothic DirectMusic segment (.sgt + .sty + .dls) to a 16-bit stereo WAV using GothicKit/dmusic.
// usage: render-music <music-dir> <segment.sgt> <out.wav> <seconds>
#include <dmusic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void* resolve(void* ctx, char const* name, size_t* len) {
	char path[1024];
	snprintf(path, sizeof path, "%s/%s", (char const*) ctx, name);
	FILE* f = fopen(path, "rb");
	if (!f) return NULL;
	fseek(f, 0, SEEK_END);
	long n = ftell(f);
	fseek(f, 0, SEEK_SET);
	void* buf = malloc((size_t) n);
	if (buf && fread(buf, 1, (size_t) n, f) != (size_t) n) { free(buf); buf = NULL; }
	fclose(f);
	*len = (size_t) n;
	return buf;
}

static void put32(FILE* f, uint32_t v) { fwrite(&v, 4, 1, f); }
static void put16(FILE* f, uint16_t v) { fwrite(&v, 2, 1, f); }

int main(int argc, char** argv) {
	if (argc < 5) { fprintf(stderr, "usage: %s <music-dir> <segment> <out.wav> <seconds>\n", argv[0]); return 1; }
	Dm_setLoggerDefault(DmLogLevel_WARN);
	const uint32_t rate = 44100;
	const double secs = atof(argv[4]);

	DmLoader* loader = NULL;
	if (DmLoader_create(&loader, DmLoader_DEFAULT | DmLoader_DOWNLOAD) != DmResult_SUCCESS) return 2;
	DmLoader_addResolver(loader, resolve, argv[1]);

	DmSegment* sgt = NULL;
	if (DmLoader_getSegment(loader, argv[2], &sgt) != DmResult_SUCCESS) { fprintf(stderr, "cannot load %s\n", argv[2]); return 3; }

	DmPerformance* perf = NULL;
	if (DmPerformance_create(&perf, rate) != DmResult_SUCCESS) return 4;
	DmPerformance_setVolume(perf, (float) (argc > 5 ? atof(argv[5]) : 0.5));
	if (DmPerformance_playSegment(perf, sgt, DmTiming_INSTANT) != DmResult_SUCCESS) { fprintf(stderr, "cannot play\n"); return 5; }

	FILE* out = fopen(argv[3], "wb");
	if (!out) return 6;
	const uint32_t frames = (uint32_t) (secs * rate), bytes = frames * 4;
	fwrite("RIFF", 1, 4, out); put32(out, 36 + bytes); fwrite("WAVEfmt ", 1, 8, out);
	put32(out, 16); put16(out, 1); put16(out, 2); put32(out, rate); put32(out, rate * 4); put16(out, 4); put16(out, 16);
	fwrite("data", 1, 4, out); put32(out, bytes);

	enum { CHUNK = 4410 };  // 100 ms of stereo frames
	int16_t buf[CHUNK * 2];
	for (uint32_t done = 0; done < frames; done += CHUNK) {
		uint32_t n = frames - done < CHUNK ? frames - done : CHUNK;
		if (DmPerformance_renderPcm(perf, buf, n * 2, DmRender_SHORT | DmRender_STEREO) != DmResult_SUCCESS) { fprintf(stderr, "render failed\n"); return 7; }
		fwrite(buf, 4, n, out);
	}
	fclose(out);
	DmPerformance_release(perf);
	DmSegment_release(sgt);
	DmLoader_release(loader);
	printf("%s -> %s (%.0fs)\n", argv[2], argv[3], secs);
	return 0;
}
