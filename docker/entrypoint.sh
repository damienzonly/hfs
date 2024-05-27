#!/bin/bash
root="/app/hfs_data/.hfs"
conf="$root/config.yaml"
initfile="$root/init"
bin="hfs@${VERSION}"
args="--cwd $root "

if [ ! -f "$conf" ] ; then
    mkdir -p "$root"
    touch "$conf"
fi
if [ ! -z "$ADMIN_PASSWORD" ] ; then
    args="$args --create-admin $ADMIN_PASSWORD "
fi
if [ ! -z "$HTTP_PORT" ] ; then
    args="$args --port $HTTP_PORT "
fi
if [ ! -z "$HTTPS_PORT" ] ; then
    args="$args --https-port $HTTPS_PORT "
fi
if [ ! -z "$CERT" ] ; then
    args="$args --cert $CERT "
fi
if [ ! -z "$PRIVATE_KEY" ] ; then
    args="$args --private-key $PRIVATE_KEY "
fi


npx $bin $args