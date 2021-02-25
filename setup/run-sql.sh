#!/bin/bash
set -e

mysql -u $2 -p$3 -h $4 $5 < $1
