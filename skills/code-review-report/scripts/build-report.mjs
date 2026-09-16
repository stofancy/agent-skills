#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { assemble, baseCSS, distinctPaths, atomicWrite } from './report-core.mjs';

try {
  const [input, output, ...args] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--title', '--css', '--lang'].includes(args[i]) || !args[i + 1] || options[args[i]] !== undefined) throw new Error('Invalid or repeated option');
    options[args[i]] = args[i + 1];
  }
  if (!input || !output || !options['--title']) throw new Error('Usage: node build-report.mjs BODY.html OUTPUT.html --title TITLE [--css CUSTOM.css] [--lang zh-CN]');
  await distinctPaths([input, output, options['--css']]);
  const body = await readFile(input, 'utf8');
  const custom = options['--css'] ? await readFile(options['--css'], 'utf8') : '';
  const html = assemble(body, options['--title'], `${await baseCSS()}\n${custom}`, options['--lang']);
  await atomicWrite(output, html);
  console.log(`Built ${output}. Assembly only; browser and editorial checks are still required.`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
