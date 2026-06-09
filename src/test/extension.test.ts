import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXTENSION_ID = 'greysquirr3l.mighty-max';

suite('Extension smoke', () => {
  test('activates without throwing', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `extension ${EXTENSION_ID} is not registered`);

    if (!extension.isActive) {
      await extension.activate();
    }
    assert.ok(extension.isActive, 'extension failed to activate');
  });

  test('exposes the management command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('mightyMax.manage'), 'mightyMax.manage command is not registered');
  });

  test('exposes the configured settings', () => {
    const config = vscode.workspace.getConfiguration('mightyMax');
    assert.ok(config.has('baseUrl'), 'mightyMax.baseUrl setting is missing');
    assert.ok(config.has('logLevel'), 'mightyMax.logLevel setting is missing');
  });
});

suite('Manifest contract', () => {
  test('package.json declares languageModelChatProviders under vendor "minimax"', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, 'extension not found');
    const contributes = extension.packageJSON.contributes as Record<string, unknown>;
    const providers = contributes.languageModelChatProviders as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(providers) && providers.length > 0, 'no languageModelChatProviders');
    assert.equal(providers[0]?.vendor, 'minimax');
    assert.equal(providers[0]?.managementCommand, 'mightyMax.manage');
  });

  test('package.json sets engines.vscode >= 1.104.0', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, 'extension not found');
    const engines = extension.packageJSON.engines as Record<string, string>;
    const versionRange = engines.vscode;
    assert.ok(versionRange, 'engines.vscode is missing');
    // Strip leading ^ or ~ and require the major version to be 1.104 or later.
    const match = /(\d+)\.(\d+)/.exec(versionRange);
    assert.ok(match, `engines.vscode is not a valid range: ${versionRange}`);
    const major = Number(match[1]);
    const minor = Number(match[2]);
    assert.ok(
      major > 1 || (major === 1 && minor >= 104),
      `engines.vscode must be >= 1.104.0, got ${versionRange}`,
    );
  });

  test('package.json declares capabilities.untrustedWorkspaces (limited)', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, 'extension not found');
    const capabilities = extension.packageJSON.capabilities as Record<string, unknown>;
    const untrusted = capabilities.untrustedWorkspaces as { supported?: string } | undefined;
    assert.ok(untrusted, 'capabilities.untrustedWorkspaces is missing');
    assert.equal(untrusted.supported, 'limited');
  });
});
