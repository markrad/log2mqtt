#! /usr/local/bin/bun

import { getLogger } from "log4js";
import minimist from 'minimist';
import mqtt, { type IClientOptions } from 'mqtt';
import { spawn } from "bun";

const logger = getLogger('log2mqtt');
logger.level = "info";


function helpExit(rc: number) {
    console.log(`bun index.ts -c <command> -t <topic> -u <userid> -P <password -s <mqtt server url>
where:
    -c (--command) <command> is the command to run - for example tail /var/logs/mylog -f
    -t (--topic) <topic> is the topic to publish the stdout and stderr on
    -u (--userid) <userid> (optional) is the userid to use to authenticate with the MQTT server
    -P (--password) <password> (optional) is the password to use to authenticate with the MQTT server
    -s (--stdtopic) (optional defaults to false) when specified will add stdout or stderr to the end of the topic
    -h (--help) displays this message
    <mqtt server url> the url of the mqtt server such as mqtt://somewhere or mqtts://somewhere_with_TLS`);
    process.exit(rc);
}

async function main() {

    logger.info('Starting...');

    const argv = minimist(process.argv.slice(2), { 
        default: { clientid: 'log2mqtt' },
        alias: { t: 'topic', c: 'command', u: 'userid', P: 'password', s: 'stdtopic', h: 'help' },
        boolean: [ 'h', 's' ] 
    });
    logger.debug(argv);

    if (argv.h) {
        helpExit(0);
    }

    if (!argv.c || typeof argv.c != 'string') {
        logger.fatal('Command string to run is required');
        helpExit(4);
    }

    if (!argv.t || typeof argv.t != 'string') {
        logger.fatal('MQTT topic is required');
        helpExit(4);
    }

    if (!argv._) {
        logger.fatal('MQTT server URL is required');
        helpExit(4);
    }

    logger.info(`Connecting to ${argv._[0]}`)

    let clientOptions: IClientOptions = { clientId: argv.clientid };
    if (argv.u) clientOptions.username = argv.u;
    if (argv.P) clientOptions.password = argv.P;

    const client = mqtt.connect(`${argv._[0]}`, clientOptions);

    client.on('connect', () => {
        logger.info('Connected');
    });

    client.on('reconnect', () => {
        logger.warn('Reconnection starting');
    });

    client.on('close', () => {
        logger.warn('Connection closed probably because the server went away');
    });

    client.on('disconnect', () => {
        logger.warn('Server sent a disconnect');
    });

    client.on('offline', () => {
        logger.error('Offline reported - possible duplicate client id');
    });

    client.on('error', (err) => {
            logger.error(`Unrecoverable error attempting to connect to the MQTT server - ${err}`);
    });

    client.on('end', () => {
        logger.info('Connection closed by request');
    });

    let myEnv = process.env;

    if (argv.e) {
        for (let e of Array.isArray(argv.e)? argv.e : [ argv.e ]) {
            let parts = e.split('=');
            console.info(`Setting environment variable ${parts[0]} to ${parts[1]}`);
            myEnv[parts[0]] = parts[1];
        }
    }

    let cmdParts = argv.c.trim().split(' ');
    logger.info(`Running command ${argv.c}`);
    const tail = spawn(cmdParts);
    const outTag = argv.t + (argv.s? '/stdout' : '');
    const errTag = argv.t + (argv.s? '/stderr' : '');

    if (tail.stdout) {
        const td = new TextDecoder();
        const reader = (tail.stdout as ReadableStream<Uint8Array<ArrayBufferLike>>).getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }   
            let decoded = td.decode(value).trimEnd().split('\n');

            for (let line of decoded) {
                logger.debug(line);
                client.publish(outTag, line);
            }
        }
    }

    if (tail.stderr) {
        const td = new TextDecoder();
        const reader = (tail.stderr as ReadableStream<Uint8Array<ArrayBufferLike>>).getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }   
            let decoded = td.decode(value).trimEnd().split('\n');

            for (let line of decoded) {
                logger.debug(line);
                client.publish(errTag, line);
            }
        }
    }
}

main().catch((err) => {
    logger.error(err);
    process.exit(1);
});