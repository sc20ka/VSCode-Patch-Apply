import * as vscode from 'vscode';
import * as Diff from 'diff';
import { TextDecoder, TextEncoder } from 'util';

type ParsedPatchType = Diff.StructuredPatch;

function normalizeLineEndings(str: string): string {
    if (!str) return '';
    return str.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

interface FileQuickPickItem extends vscode.QuickPickItem {
    action: 'select_this_uri' | 'choose_manually' | 'cancel_operation';
    uri?: vscode.Uri;
}

export class PatchApplyViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'vscodepatchapply.patchView';
    private _view?: vscode.WebviewView;
    private _currentRawDiffText: string = '';

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'applyDiff': // Renamed from 'applyDiff' to 'createDiffView' in HTML/JS for clarity
                    this._currentRawDiffText = data.value;
                    if (!this._currentRawDiffText) {
                        vscode.window.showErrorMessage('Diff text is empty.');
                        return;
                    }
                    await this.processAndShowAllDiffs(this._currentRawDiffText);
                    break;
                case 'applyPatchToFile':
                    const diffToApply = data.value || this._currentRawDiffText;
                    if (!diffToApply) {
                        vscode.window.showErrorMessage('Diff text is empty. Paste a diff first.');
                        return;
                    }
                    await this.applyAllPatchesToFiles(diffToApply);
                    break;
                case 'showError':
                    vscode.window.showErrorMessage(data.message);
                    break;
            }
        });
    }

    private cleanDiffInput(rawDiffText: string): string {
        let cleanDiffText = rawDiffText.trim();
        if (cleanDiffText.startsWith('```diff')) {
            cleanDiffText = cleanDiffText.substring('```diff'.length);
        }
        if (cleanDiffText.endsWith('```')) {
            cleanDiffText = cleanDiffText.substring(0, cleanDiffText.length - '```'.length);
        }
        return cleanDiffText.trim();
    }

    private async processAndShowAllDiffs(rawDiffText: string) {
        const cleanDiffText = this.cleanDiffInput(rawDiffText);

        if (!cleanDiffText) {
            vscode.window.showInformationMessage('No diff content to process after cleaning markers.');
            return;
        }

        let parsedPatches: ParsedPatchType[];
        try {
            parsedPatches = Diff.parsePatch(cleanDiffText);
            if (!parsedPatches || parsedPatches.length === 0) {
                vscode.window.showErrorMessage('Could not parse the diff or no changes found. Is it a valid unified diff?');
                return;
            }
        } catch (error) {
            console.error("Error parsing diff:", error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Error parsing diff: ${errorMessage}`);
            if (this._view) {
                this._view.webview.postMessage({ type: 'parseError', message: `Error parsing diff: ${errorMessage}` });
            }
            return;
        }

        let diffsShownCount = 0;
        for (const patch of parsedPatches) {
            if (!patch.hunks || patch.hunks.length === 0) {
                const patchFileName = patch.oldFileName || patch.newFileName || 'unknown file';
                vscode.window.showInformationMessage(`Skipping diff view for ${patchFileName.replace(/^[ab]\//, '')} as it has no changes (hunks).`);
                continue;
            }

            try {
                let originalContentLines: string[] = [];
                let newContentLines: string[] = [];

                patch.hunks.forEach(hunk => {
                    hunk.lines.forEach(line => {
                        const changeType = line.charAt(0);
                        const lineContent = line.substring(1);
                        if (changeType === ' ' || changeType === '-') {
                            originalContentLines.push(lineContent);
                        }
                        if (changeType === ' ' || changeType === '+') {
                            newContentLines.push(lineContent);
                        }
                    });
                });

                const originalContent = normalizeLineEndings(originalContentLines.join('\n'));
                const newContent = normalizeLineEndings(newContentLines.join('\n'));

                const originalDoc = await vscode.workspace.openTextDocument({ content: originalContent, language: 'text' });
                const newDoc = await vscode.workspace.openTextDocument({ content: newContent, language: 'text' });

                const originalFileName = patch.oldFileName ? patch.oldFileName.replace(/^a\//, '') : 'original.txt';
                const newFileName = patch.newFileName ? patch.newFileName.replace(/^b\//, '') : 'modified.txt';
                const title = `Diff: ${originalFileName}  ↔  ${newFileName}`;

                await vscode.commands.executeCommand('vscode.diff', originalDoc.uri, newDoc.uri, title, {
                    preview: true,
                });
                diffsShownCount++;
            } catch (error) {
                console.error("Error showing diff for a patch:", error);
                const patchFileName = patch.oldFileName || patch.newFileName || 'unknown file';
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Error processing diff view for ${patchFileName.replace(/^[ab]\//, '')}: ${errorMessage}`);
                if (this._view) {
                    this._view.webview.postMessage({ type: 'parseError', message: `Error (diff view for ${patchFileName.replace(/^[ab]\//, '')}): ${errorMessage}` });
                }
            }
        }

        if (diffsShownCount > 0) {
            vscode.window.showInformationMessage(`Opened ${diffsShownCount} diff view(s).`);
        } else if (parsedPatches.length > 0) {
            vscode.window.showWarningMessage('No diff views were opened. Check diff content or previous messages.');
        }
    }

    private async applyAllPatchesToFiles(rawDiffText: string) {
        const cleanDiffText = this.cleanDiffInput(rawDiffText);
        if (!cleanDiffText) {
            vscode.window.showInformationMessage('No diff content to process for applying to file.');
            return;
        }

        let parsedPatches: ParsedPatchType[];
        try {
            parsedPatches = Diff.parsePatch(cleanDiffText);
            if (!parsedPatches || parsedPatches.length === 0) {
                vscode.window.showErrorMessage('Could not parse the diff for applying or no changes found. Ensure it is a valid unified diff format.');
                if (this._view) {
                     this._view.webview.postMessage({ type: 'parseError', message: 'Could not parse the diff for applying or no changes found.' });
                }
                return;
            }
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`Error parsing diff for applying: ${errorMessage}`);
            if (this._view) {
                this._view.webview.postMessage({ type: 'parseError', message: `Error parsing diff for applying: ${errorMessage}` });
            }
            return;
        }

        let appliedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (const patchObjectToApply of parsedPatches) {
            const patchName = (patchObjectToApply.oldFileName || patchObjectToApply.newFileName || "unknown_file").replace(/^[ab]\//, '');
            if (!patchObjectToApply.hunks || patchObjectToApply.hunks.length === 0) {
                vscode.window.showInformationMessage(`Skipping patch for '${patchName}' as it has no content/hunks.`);
                skippedCount++;
                continue;
            }

            try {
                const success = await this.applySinglePatch(patchObjectToApply);
                if (success) {
                    appliedCount++;
                } else {
                    skippedCount++; // Or errorCount, depending on if applySinglePatch distinguishes cancellation from error
                }
            } catch (err) { // Catch unexpected errors from applySinglePatch itself
                errorCount++;
                const errorMessage = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`Critical error while processing patch for '${patchName}': ${errorMessage}`);
            }
        }

        let summaryMessage = `Patch application process finished. Applied: ${appliedCount}, Skipped/Cancelled: ${skippedCount}, Errors: ${errorCount}.`;
        if (errorCount > 0) {
            vscode.window.showErrorMessage(summaryMessage + " Check previous messages for details.");
        } else if (appliedCount > 0) {
            vscode.window.showInformationMessage(summaryMessage);
        } else {
            vscode.window.showWarningMessage(summaryMessage + " No patches were successfully applied.");
        }
    }

    private async applySinglePatch(patchObjectToApply: ParsedPatchType): Promise<boolean> {
        const isNewFile = patchObjectToApply.oldFileName === 'a/dev/null' || patchObjectToApply.oldFileName === '/dev/null';
        const isDeletedFile = patchObjectToApply.newFileName === 'b/dev/null' || patchObjectToApply.newFileName === '/dev/null';

        let displayFileName: string | undefined;
        let searchFileNameNormalized: string | undefined;

        if (isNewFile) {
            searchFileNameNormalized = patchObjectToApply.newFileName?.replace(/^b\//, '');
        } else { // Modification or Deletion
            searchFileNameNormalized = patchObjectToApply.oldFileName?.replace(/^a\//, '');
        }
        displayFileName = searchFileNameNormalized || (patchObjectToApply.newFileName?.replace(/^b\//, '')) || "unknown_file";


        if (!searchFileNameNormalized || searchFileNameNormalized === '/dev/null' || searchFileNameNormalized.trim() === '') {
            if (isNewFile && patchObjectToApply.newFileName) { // Could be a valid new file name like 'newfile.txt'
                 searchFileNameNormalized = patchObjectToApply.newFileName.replace(/^b\//, '');
                 displayFileName = searchFileNameNormalized;
            } else {
                vscode.window.showErrorMessage(`Could not determine a valid file name from patch: old='${patchObjectToApply.oldFileName}', new='${patchObjectToApply.newFileName}'. Skipping.`);
                return false;
            }
        }
        
        let targetFileUri: vscode.Uri | undefined;

        if (isNewFile) {
            const wsFolder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0 ? vscode.workspace.workspaceFolders[0].uri : undefined;
            const defaultPath = wsFolder ? vscode.Uri.joinPath(wsFolder, searchFileNameNormalized).fsPath : searchFileNameNormalized;

            const chosenPathStr = await vscode.window.showInputBox({
                prompt: `Enter path to create new file: ${searchFileNameNormalized}`,
                value: defaultPath,
                placeHolder: "Enter full path for the new file"
            });

            if (chosenPathStr) {
                targetFileUri = vscode.Uri.file(chosenPathStr);
            } else {
                vscode.window.showInformationMessage(`Creation of new file '${searchFileNameNormalized}' cancelled.`);
                return false;
            }
        } else { // Modification or Deletion - Find existing file
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                const wsFolder = vscode.workspace.workspaceFolders[0].uri;
                let foundFilesUris: vscode.Uri[] = [];

                try { // Try exact path match first relative to workspace root
                    const potentialUri = vscode.Uri.joinPath(wsFolder, searchFileNameNormalized);
                    try {
                        await vscode.workspace.fs.stat(potentialUri);
                        foundFilesUris.push(potentialUri);
                    } catch { /* file not at this exact path */ }
                } catch (e) { /* ignore error from joinPath if searchFileNameNormalized is invalid */ }


                if (foundFilesUris.length === 0) { // If not found by direct join, try findFiles
                    try {
                        // Search for the file name more broadly if not found directly
                        const globPattern = `**/${searchFileNameNormalized.split('/').pop()}`; // Search for basename
                        foundFilesUris = await vscode.workspace.findFiles(globPattern, '**/node_modules/**', 5);
                    } catch (e) { /* Ignored */ }
                }
                
                if (foundFilesUris.length === 1) {
                    const relativePath = vscode.workspace.asRelativePath(foundFilesUris[0]);
                    const choice = await vscode.window.showQuickPick(
                        ["Yes, Apply to this file", "Choose Different File", "Cancel"],
                        { placeHolder: `Found: ${relativePath} for patch target '${displayFileName}'. Apply patch?`, canPickMany: false }
                    );
                    if (choice === "Yes, Apply to this file") {
                        targetFileUri = foundFilesUris[0];
                    } else if (choice === "Cancel" || !choice) {
                        vscode.window.showInformationMessage(`Patch application for '${displayFileName}' cancelled.`);
                        return false;
                    } // If "Choose Different File", targetFileUri remains undefined, prompting manual selection
                } else if (foundFilesUris.length > 1) {
                    const quickPickItems: FileQuickPickItem[] = foundFilesUris.map(fUri => ({
                        label: vscode.workspace.asRelativePath(fUri),
                        uri: fUri,
                        action: 'select_this_uri'
                    }));
                    quickPickItems.push({ label: "Choose Different File (Manually)", action: 'choose_manually' });
                    quickPickItems.push({ label: "Cancel", action: 'cancel_operation' });

                    const chosenItem = await vscode.window.showQuickPick<FileQuickPickItem>(
                        quickPickItems, { placeHolder: `Multiple files found for '${displayFileName}'. Select one or choose manually:`, canPickMany: false }
                    );

                    if (!chosenItem || chosenItem.action === 'cancel_operation') {
                        vscode.window.showInformationMessage(`Patch application for '${displayFileName}' cancelled.`);
                        return false;
                    }
                    if (chosenItem.action === 'select_this_uri' && chosenItem.uri) {
                        targetFileUri = chosenItem.uri;
                    } // If 'choose_manually', targetFileUri remains undefined
                }
            }
            // If targetFileUri is still not set (no workspace, file not found, or user chose to pick manually)
            if (!targetFileUri) {
                const openDialogOptions: vscode.OpenDialogOptions = {
                    canSelectMany: false,
                    openLabel: `Select Target File for Patch: '${displayFileName}'`,
                    filters: { 'All files': ['*'] }
                };
                if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                    try {
                        openDialogOptions.defaultUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, searchFileNameNormalized);
                    } catch (e) { /* ignore if searchFileNameNormalized is bad */ }
                } else if (searchFileNameNormalized) {
                    // Try to construct a URI if no workspace, this might not resolve well but better than nothing
                     try { openDialogOptions.defaultUri = vscode.Uri.file(searchFileNameNormalized); } catch (e) {/*ignore*/}
                }

                const uris = await vscode.window.showOpenDialog(openDialogOptions);
                if (uris && uris.length > 0) {
                    targetFileUri = uris[0];
                } else {
                    vscode.window.showInformationMessage(`No file selected for '${displayFileName}'. Patch application cancelled for this file.`);
                    return false;
                }
            }
        }
        
        if (!targetFileUri) {
            vscode.window.showErrorMessage(`Could not determine target file for patch '${displayFileName}'. Skipping.`);
            return false;
        }

        try {
            let originalFileContent = '';
            let fileExists = false;

            try {
                const stat = await vscode.workspace.fs.stat(targetFileUri);
                if (stat.type === vscode.FileType.Directory) {
                     vscode.window.showErrorMessage(`Target path ${vscode.workspace.asRelativePath(targetFileUri)} for '${displayFileName}' is a directory. Cannot apply patch.`);
                     return false;
                }
                fileExists = true;
            } catch (e: any) {
                if (e.code === 'FileNotFound' || e.name === 'EntryNotFound') { // Handle both common error codes for not found
                    fileExists = false;
                } else {
                    throw e; // Rethrow other stat errors (e.g., permission)
                }
            }

            if (isNewFile) {
                if (fileExists) {
                    const overwrite = await vscode.window.showWarningMessage(
                        `Target file ${vscode.workspace.asRelativePath(targetFileUri)} for new file patch '${displayFileName}' already exists. Overwrite?`,
                        { modal: true }, "Overwrite"
                    );
                    if (overwrite !== "Overwrite") {
                        vscode.window.showInformationMessage(`Patch application for new file '${displayFileName}' cancelled due to existing file.`);
                        return false;
                    }
                }
                originalFileContent = ''; // Patch is expected to create the full content
            } else { // Modification or Deletion
                if (!fileExists) {
                    vscode.window.showErrorMessage(`Target file ${vscode.workspace.asRelativePath(targetFileUri)} for '${displayFileName}' not found. Cannot apply modification/deletion patch.`);
                    return false;
                }
                const originalFileContentBytes = await vscode.workspace.fs.readFile(targetFileUri);
                originalFileContent = new TextDecoder().decode(originalFileContentBytes);
            }

            const normalizedOriginalContent = normalizeLineEndings(originalFileContent);
            const patchedContentResult = Diff.applyPatch(normalizedOriginalContent, patchObjectToApply, {
                fuzzFactor: 2 // Add a small fuzz factor for robustness
            });


            if (patchedContentResult === false) {
                vscode.window.showErrorMessage(
                    `Failed to apply patch to ${vscode.workspace.asRelativePath(targetFileUri)} for '${displayFileName}'. ` +
                    `File content might not match the patch's expected original state (even with fuzziness). ` +
                    `Ensure the correct file is selected and it has not been modified too extensively.`
                );
                return false;
            }
            
            if (isDeletedFile) {
                 if (patchedContentResult.trim() === '') {
                    await vscode.workspace.fs.delete(targetFileUri);
                    vscode.window.showInformationMessage(`Patch applied and file ${vscode.workspace.asRelativePath(targetFileUri)} ('${displayFileName}') successfully deleted.`);
                } else {
                    // If patch was for deletion but result is not empty, write the (unexpected) content.
                    await vscode.workspace.fs.writeFile(targetFileUri, new TextEncoder().encode(patchedContentResult));
                    vscode.window.showWarningMessage(`Patch for deleting ${vscode.workspace.asRelativePath(targetFileUri)} ('${displayFileName}') resulted in non-empty content. File was updated instead of deleted.`);
                     const doc = await vscode.workspace.openTextDocument(targetFileUri);
                     await vscode.window.showTextDocument(doc);
                }
            } else { // New file or Modification
                await vscode.workspace.fs.writeFile(targetFileUri, new TextEncoder().encode(patchedContentResult));
                vscode.window.showInformationMessage(`Patch successfully applied to ${vscode.workspace.asRelativePath(targetFileUri)} ('${displayFileName}').`);
                
                if (patchedContentResult !== '') { // Open if content is not empty
                     const doc = await vscode.workspace.openTextDocument(targetFileUri);
                     await vscode.window.showTextDocument(doc);
                } else if (isNewFile && patchedContentResult === '') {
                    vscode.window.showInformationMessage(`New file ${vscode.workspace.asRelativePath(targetFileUri)} ('${displayFileName}') was created empty by the patch.`);
                }
            }
            return true;

        } catch (err) {
            console.error(`Error applying patch to ${targetFileUri.fsPath} for '${displayFileName}':`, err);
            const relativePath = vscode.workspace.asRelativePath(targetFileUri);
            const errorMessage = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Error applying patch to ${relativePath} ('${displayFileName}'): ${errorMessage}`);
            return false;
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'styles.css'));
        const nonce = getNonce();

        // Note: In your main.js, ensure the message for 'applyDiff' is now 'createDiffViewButton' if you changed button ID
        // or that 'applyDiff' is the message type sent from 'createDiffViewButton'.
        // The JS code sends 'applyDiff' for the "Create Diff View" button, which is fine.
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                <link href="${styleUri}" rel="stylesheet">
                <title>Patch Apply</title>
            </head>
            <body>
                <h3>Paste Diff Text</h3>
                <textarea id="diffInput" rows="10" placeholder="Paste your diff here (unified format)..."></textarea>
                <button id="createDiffViewButton">Create Diff View(s)</button>
                <button id="applyToFileButton" style="margin-top: 8px;">Apply Patch(es) to Target File(s)</button>
                <div id="error-message" class="error" style="margin-top: 8px;"></div>

                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}