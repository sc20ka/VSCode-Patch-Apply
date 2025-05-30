
# VSCode Patch Apply

A Visual Studio Code extension to easily apply code patches from unified diff text. Preview changes in a diff view and then apply them directly to your workspace files. Ideal for integrating code modifications provided by Large Language Models (LLMs) or collaborators when a full patch file isn't available.

## Overview

Ever have a piece of code, maybe from an LLM or a colleague, that's provided as a `diff` block and you want to quickly see how it changes your files and then apply it? This extension streamlines that process.

You can paste a raw unified diff into the extension's view, preview each file's changes in VS Code's native diff viewer, and then apply those changes to the respective files in your project. It handles creating new files, modifying existing ones, and deleting files based on the provided patch.

## Features

*   **Paste & Preview:** Directly paste unified diff text into the extension's sidebar.
*   **Clean Input:** Automatically removes common markdown fences (like ` ```diff` and ````) from the pasted diff.
*   **Integrated Diff View:** Click "Create Diff View(s)" to open VS Code's built-in diff viewer for each file affected by the patch, showing the proposed changes clearly.
*   **Apply to Files:** Click "Apply Patch(es) to Target File(s)" to apply the modifications.
    *   **File Detection:** Attempts to find the correct target files in your workspace.
    *   **Manual Selection:** Prompts for file selection if a target file cannot be uniquely identified or if multiple candidates are found.
    *   **New File Creation:** Asks for confirmation and location when the patch indicates a new file.
    *   **File Deletion:** Handles patches that specify file deletions.
*   **Error Handling:** Provides feedback and error messages if the diff is malformed or if issues occur during the application process.
*   **Multi-File Patch Support:** Supports patches that include changes for multiple files.

## How to Use

1.  **Install the Extension:** (Once published, add instructions here. For now, it's via local build/sideloading).
2.  **Open the Patch Apply View:**
    *   Look for the "Patch Apply" icon in the Activity Bar (the specific icon will depend on how it's configured, or you can open it via the Command Palette: `View: Show Patch Apply`).
3.  **Paste Your Diff:**
    *   Copy the unified diff text you want to apply.
    *   Paste it into the text area provided in the "Patch Apply" view.
4.  **Preview Changes (Recommended):**
    *   Click the **"Create Diff View(s)"** button.
    *   This will open one or more diff tabs in VS Code, showing the changes for each file described in the patch. Review them to ensure they are what you expect.
5.  **Apply the Patch:**
    *   If you're happy with the preview, click the **"Apply Patch(es) to Target File(s)"** button in the extension's view.
    *   The extension will then attempt to:
        *   Identify the target files in your current workspace.
        *   If a file is new, it will prompt you for the path to create it.
        *   If a file path is ambiguous, it might ask you to select the correct file.
        *   Apply the changes.
    *   You'll receive notifications about the success or any issues encountered.
  
    ![output](https://github.com/user-attachments/assets/f1eaee40-5482-4243-8a24-20169e52eaf9)


## Generating Diffs with LLMs (Prompt Examples)

To get code modifications from Large Language Models (LLMs) in a format this extension can use, you need to ask for changes in the **unified diff format**. Here are some example prompts:

**General Request:**

> "Please provide the code changes in the unified diff format."

**Modifying Existing Code:**

> "I have this code in `src/utils.js`:
> ```javascript
> // [original code snippet]
> ```
> Please refactor the main function to improve readability and add a try-catch block for error handling. Output the changes as a unified diff for `src/utils.js`."

**Adding a New File:**

> "Create a new Python script named `data_processor.py` that contains a function to read a CSV file and print its headers. Provide the output as a unified diff, indicating it's a new file."
>
> *LLM might output something starting like:*
> ```diff
> --- a/dev/null
> +++ b/data_processor.py
> @@ -0,0 +1,5 @@
> +import csv
> +
> +def print_csv_headers(filepath):
> +    # ... rest of the code
> ```
