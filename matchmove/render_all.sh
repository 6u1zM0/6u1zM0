#!/usr/bin/env bash
# Full build: frames (parallel chunks) -> concat -> silent master + delivery encode (captions burned in, no audio).   Usage: ./render_all.sh [chunk indices to (re)render...]
set -euo pipefail
cd "$(dirname "$0")"
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"
CH=300; N=16; JOBS="${JOBS:-4}"
mkdir -p out/seg
[ -f src/timeline.json ] || python3 src/make_vo.py af_heart 1.0   # caption timings come from the guide VO
LIST="${*:-$(seq 0 $((N-1)))}"
echo $LIST | tr ' ' '\n' | xargs -P "$JOBS" -I{} sh -c 'node src/render.mjs range $(({}*'$CH')) $((({}+1)*'$CH')) out/seg/seg_$(printf %02d {}).mp4 > out/seg/log_{}.txt 2>&1'
for i in $(seq 0 $((N-1))); do echo "file 'seg/seg_$(printf %02d $i).mp4'"; done > out/concat.txt
ffmpeg -y -loglevel error -f concat -safe 0 -i out/concat.txt -map 0:v -c:v copy -an -movflags +faststart -t 160 out/matchmove_master.mp4
# delivery encode (the master keeps the grain at ~37 Mb/s)
ffmpeg -y -loglevel error -i out/matchmove_master.mp4 -c:v libx264 -preset slow -crf 22 -maxrate 14M -bufsize 28M -pix_fmt yuv420p -g 60 -color_primaries bt709 -color_trc bt709 -colorspace bt709 -an -movflags +faststart out/matchmove_explainer.mp4
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate,nb_frames -of compact out/matchmove_explainer.mp4
