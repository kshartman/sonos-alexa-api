#!/bin/bash

#export SONOS_IP=<a coordinatorip> or specifiy on command line
node ./sonos-dump-all.cjs > ../temp/sonosdump.txt
echo ../temp/sonosdump.txt
