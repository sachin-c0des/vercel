import { lstatSync } from 'fs-extra';

import { isAbsolute } from 'path';
import { hashes, mapToObject, resolveNftJsonFiles } from './utils/hashes';
import { upload } from './upload';
import { buildFileTree, createDebug } from './utils';
import { DeploymentError } from './errors';
import {
  VercelClientOptions,
  DeploymentOptions,
  DeploymentEventType,
} from './types';

export default function buildCreateDeployment() {
  return async function* createDeployment(
    clientOptions: VercelClientOptions,
    deploymentOptions: DeploymentOptions = {}
  ): AsyncIterableIterator<{ type: DeploymentEventType; payload: any }> {
    const { path } = clientOptions;

    const debug = createDebug(clientOptions.debug);

    debug('Creating deployment...');

    if (typeof path !== 'string' && !Array.isArray(path)) {
      debug(
        `Error: 'path' is expected to be a string or an array. Received ${typeof path}`
      );

      throw new DeploymentError({
        code: 'missing_path',
        message: 'Path not provided',
      });
    }

    if (typeof clientOptions.token !== 'string') {
      debug(
        `Error: 'token' is expected to be a string. Received ${typeof clientOptions.token}`
      );

      throw new DeploymentError({
        code: 'token_not_provided',
        message: 'Options object must include a `token`',
      });
    }

    clientOptions.isDirectory =
      !Array.isArray(path) && lstatSync(path).isDirectory();

    if (Array.isArray(path)) {
      for (const filePath of path) {
        if (!isAbsolute(filePath)) {
          throw new DeploymentError({
            code: 'invalid_path',
            message: `Provided path ${filePath} is not absolute`,
          });
        }
      }
    } else if (!isAbsolute(path)) {
      throw new DeploymentError({
        code: 'invalid_path',
        message: `Provided path ${path} is not absolute`,
      });
    }

    if (clientOptions.isDirectory && !Array.isArray(path)) {
      debug(`Provided 'path' is a directory.`);
    } else if (Array.isArray(path)) {
      debug(`Provided 'path' is an array of file paths`);
    } else {
      debug(`Provided 'path' is a single file`);
    }

    let { fileList } = await buildFileTree(path, clientOptions, debug);

    // This is a useful warning because it prevents people
    // from getting confused about a deployment that renders 404.
    if (fileList.length === 0) {
      debug('Deployment path has no files. Yielding a warning event');
      yield {
        type: 'warning',
        payload: 'There are no files inside your deployment.',
      };
    }

    const hashedFileMap = await hashes(fileList);
    const nftFileList = clientOptions.prebuilt
      ? await resolveNftJsonFiles(hashedFileMap)
      : [];
    const files = await hashes(nftFileList, hashedFileMap);

    debug(`Yielding a 'hashes-calculated' event with ${files.size} hashes`);
    yield { type: 'hashes-calculated', payload: mapToObject(files) };

    if (clientOptions.apiUrl) {
      debug(`Using provided API URL: ${clientOptions.apiUrl}`);
    }

    if (clientOptions.userAgent) {
      debug(`Using provided user agent: ${clientOptions.userAgent}`);
    }

    debug(`Setting platform version to harcoded value 2`);
    deploymentOptions.version = 2;

    debug(`Creating the deployment and starting upload...`);
    for await (const event of upload(files, clientOptions, deploymentOptions)) {
      debug(`Yielding a '${event.type}' event`);
      yield event;
    }
  };
}
