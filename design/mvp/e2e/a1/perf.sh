#!/bin/zsh
# perf.sh <pid-head> <pid-trunk> <out>: %cpu and rss of both every 10 s for 10 minutes.
echo "t head_cpu head_rss_kb trunk_cpu trunk_rss_kb" > $3
for i in {1..60}; do
  echo "$(date +%T) $(ps -o %cpu=,rss= -p $1 | xargs) $(ps -o %cpu=,rss= -p $2 | xargs)" >> $3
  sleep 10
done
