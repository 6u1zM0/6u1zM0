#!/usr/bin/env bash
# vsheet.sh out.jpg t1 t2 ... : contact sheet (3 columns) from the rendered video
o=$1; shift; i=0; in=""
for t in "$@"; do ffmpeg -y -loglevel error -ss $t -i out/matchmove_explainer.mp4 -frames:v 1 -vf scale=640:360 out/rev/_f$i.png; in="$in -i out/rev/_f$i.png"; i=$((i+1)); done
rows=$(( (i+2)/3 ))
ffmpeg -y -loglevel error $in -filter_complex "concat=n=$i:v=1,tile=3x$rows" -frames:v 1 -q:v 3 $o
