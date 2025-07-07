#!/bin/bash

#export SONOS_IP=<a coordinatorip> or specifiy on command line
node ./sonos-dump-all.js > ../temp/sonosdump.txt
echo ../temp/sonosdump.txt
