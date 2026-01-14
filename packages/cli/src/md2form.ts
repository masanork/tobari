#!/usr/bin/env bun
import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import { parseMarkdown } from '@tobari/compiler';

// Runtime location: relative to the built binary or source
// In monorepo dev, we can find it in ../form-runtime/dist/index.js
// In production, it might be bundled or located in node_modules
async function getRuntimeScript(projectRoot: string): Promise<string> {
    const devPath = path.resolve(projectRoot, 'packages/form-runtime/dist/index.js');
    if (await fs.pathExists(devPath)) {
        return await fs.readFile(devPath, 'utf-8');
    }
    // Fallback: look in node_modules if installed
    // const prodPath = require.resolve('@tobari/form-runtime/dist/index.js');
    // return await fs.readFile(prodPath, 'utf-8');

    throw new Error(`Runtime script not found at ${devPath}`);
}

const program = new Command();

program
    .name('md2form')
    .description('Convert Web/A Markdown to standalone HTML Form')
    .argument('<input>', 'Input markdown file')
    .option('-o, --output <path>', 'Output HTML file path')
    .action(async (input, options) => {
        try {
            const inputPath = path.resolve(input);
            const outputPath = options.output
                ? path.resolve(options.output)
                : inputPath.replace(/\.md$/, '.html');

            if (!await fs.pathExists(inputPath)) {
                console.error(`Error: File not found: ${inputPath}`);
                process.exit(1);
            }

            console.log(`Reading ${inputPath}...`);
            const markdown = await fs.readFile(inputPath, 'utf-8');

            console.log('Compiling...');
            const { html: formHtml, jsonStructure } = parseMarkdown(markdown);

            console.log('Injecting runtime...');
            // Find project root relative to this script execution
            // We assume we are running from repo root or similar in dev
            const projectRoot = process.cwd();
            const runtimeScript = await getRuntimeScript(projectRoot);

            const title = jsonStructure.name || 'Web/A Form';

            const fullHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        /* Minimal Reset & Style */
        body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
        .form-row { margin-bottom: 15px; }
        .form-label { display: block; font-weight: bold; margin-bottom: 5px; }
        .form-input { width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; }
        .btn-submit-ready { background-color: #10b981; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
        .btn-submit-incomplete { background-color: #ccc; color: #666; border: none; padding: 10px 20px; border-radius: 4px; cursor: not-allowed; }
        .table-wrapper { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #f4f4f5; font-weight: 600; }
        .no-print { display: flex; gap: 10px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="page">
        ${formHtml}
    </div>

    <!-- Structure Data -->
    <script id="weba-structure" type="application/json">
        ${JSON.stringify(jsonStructure)}
    </script>

    <!-- Runtime -->
    <script>
        ${runtimeScript}
    </script>
</body>
</html>`;

            await fs.writeFile(outputPath, fullHtml);
            console.log(`Generated: ${outputPath}`);

        } catch (e: any) {
            console.error('Build failed:', e.message);
            process.exit(1);
        }
    });

program.parse();
