/* eslint-disable
  import/first,
  import/order,
  comma-dangle,
  linebreak-style,
  no-param-reassign,
  no-underscore-dangle,
  prefer-destructuring
*/
import schema from './options.json';
import loaderUtils from 'loader-utils';
import validateOptions from 'schema-utils';

import NodeTargetPlugin from 'webpack/lib/node/NodeTargetPlugin';
import SingleEntryPlugin from 'webpack/lib/SingleEntryPlugin';
import WebWorkerTemplatePlugin from 'webpack/lib/webworker/WebWorkerTemplatePlugin';
import ExternalsPlugin from 'webpack/lib/ExternalsPlugin';

import getWorker from './workers/';
import LoaderError from './Error';

export default function loader() {}

export function pitch(request) {
  const options = loaderUtils.getOptions(this) || {};

  validateOptions(schema, options, 'Fork Loader');

  if (!this.webpack) {
    throw new LoaderError({
      name: 'Fork Loader',
      message: 'This loader is only usable with webpack'
    });
  }

  this.cacheable(false);

  const cb = this.async();

  const filename = loaderUtils.interpolateName(this, options.name || '[hash].fork.js', {
    context: options.context || this.rootContext || this.options.context,
    regExp: options.regExp,
  });

  const worker = {};

  const compilerOptions = this._compiler.options || {};

  worker.options = {
    filename,
    chunkFilename: `[id].${filename}`,
    namedChunkFilename: null,
  };

  worker.compiler = this._compilation
    .createChildCompiler('worker', worker.options);

  // Tapable.apply is deprecated in tapable@1.0.0-x.
  // The plugins should now call apply themselves.
  if (compilerOptions.externals) {
    const externalsType =
      compilerOptions.output.libraryTarget ||
      compilerOptions.externalsType ||
      (compilerOptions.output.library && compilerOptions.output.library.type) ||
      (compilerOptions.output.module ? 'module' : 'var');
    new ExternalsPlugin(externalsType, compilerOptions.externals).apply(worker.compiler);
  }

  new WebWorkerTemplatePlugin(worker.options).apply(worker.compiler);

  if (this.target !== 'webworker' && this.target !== 'web') {
    new NodeTargetPlugin().apply(worker.compiler);
  }

  new SingleEntryPlugin(this.context, `!!${request}`, 'main').apply(worker.compiler);

  const subCache = `subcache ${__dirname} ${request}`;

  worker.compilation = (compilation) => {
    if (compilation.cache) {
      if (!compilation.cache[subCache]) {
        compilation.cache[subCache] = {};
      }

      compilation.cache = compilation.cache[subCache];
    }
  };

  if (worker.compiler.hooks) {
    const plugin = { name: 'WorkerLoader' };

    worker.compiler.hooks.compilation.tap(plugin, worker.compilation);
  } else {
    worker.compiler.plugin('compilation', worker.compilation);
  }

  worker.compiler.runAsChild((err, entries, compilation) => {
    if (err) return cb(err);

    if (entries[0]) {
      worker.file = entries[0].files[0];

      worker.factory = getWorker(
        worker.file,
        compilation.assets[worker.file].source(),
        options
      );

      return cb(null, `module.exports = function() {\n  return ${worker.factory};\n};`);
    }

    return cb(null, null);
  });
}
