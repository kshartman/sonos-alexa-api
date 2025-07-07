#!/bin/bash

#export SONOS_IP=<a coordinatorip> or specifiy on command line
node ./pandora-dump-all.cjs > ../temp/pandoradump.txt
echo ../temp/pandoradump.txt
