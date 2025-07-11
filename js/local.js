import { displayDirectoryStructure, sortContents, getSelectedFiles, formatRepoContents } from './utils.js';
import { extractZipContents } from './zip-utils.js';

// Add at the top of the file with other imports
let pathZipMap = {};
let individualFiles = [];

// Event listener for directory selection
document.getElementById('directoryPicker').addEventListener('change', handleDirectorySelection);

// Event listener for zip file selection
document.getElementById('zipPicker').addEventListener('change', handleZipSelection);

// Event listener for individual file selection
document.getElementById('filePicker').addEventListener('change', handleFileSelection);

async function handleDirectorySelection(event) {
    const files = event.target.files;
    if (files.length === 0) return;

    const gitignoreContent = ['.git/**']
    const tree = [];
    for (let file of files) {
        const filePath = file.webkitRelativePath.startsWith('/') ? file.webkitRelativePath.slice(1) : file.webkitRelativePath;
        tree.push({
            path: filePath,
            type: 'blob',
            urlType: 'directory',
            url: URL.createObjectURL(file)
        });
        if (file.webkitRelativePath.endsWith('.gitignore')) {
            const gitignoreReader = new FileReader();
            gitignoreReader.onload = function(e) {
                const content = e.target.result;
                const lines = content.split('\n');
                const gitignorePath = file.webkitRelativePath.split('/').slice(0, -1).join('/');
                lines.forEach(line => {
                    line = line.trim();
                    if (line && !line.startsWith('#')) {
                        if (gitignorePath) {
                            gitignoreContent.push(`${gitignorePath}/${line}`);
                        } else {
                            gitignoreContent.push(line);
                        }
                    }
                });
                const combinedTree = mergeFileTrees(tree, individualFiles);
                filterAndDisplayTree(combinedTree, gitignoreContent);
            };
            gitignoreReader.readAsText(file);
        }
    }
    const combinedTree = mergeFileTrees(tree, individualFiles);
    filterAndDisplayTree(combinedTree, gitignoreContent);
}

// Handle zip file selection
async function handleZipSelection(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        // Clear the directory picker
        document.getElementById('directoryPicker').value = '';

        // Extract zip contents and update the global pathZipMap
        const { tree, gitignoreContent, pathZipMap: extractedPathZipMap } = await extractZipContents(file);
        pathZipMap = extractedPathZipMap;  // Update the global variable
        
        // Merge with individual files and display
        const combinedTree = mergeFileTrees(tree, individualFiles);
        filterAndDisplayTree(combinedTree, gitignoreContent);
    } catch (error) {
        const outputText = document.getElementById('outputText');
        outputText.value = `Error processing zip file: ${error.message}\n\n` +
            "Please ensure:\n" +
            "1. The zip file is not corrupted.\n" +
            "2. The zip file contains text files that can be read.\n" +
            "3. The zip file format is supported (.zip, .rar, .7z).\n";
    }
}

function filterAndDisplayTree(tree, gitignoreContent) {
    // Filter tree based on gitignore rules
    const filteredTree = tree.filter(file => !isIgnored(file.path, gitignoreContent));

    // Sort the tree
    filteredTree.sort(sortContents);

    // Display the directory structure
    displayDirectoryStructure(filteredTree);

    // Show the generate text button
    document.getElementById('generateTextButton').style.display = 'flex';
}

// Event listener for generating text file
document.getElementById('generateTextButton').addEventListener('click', async function () {
    const outputText = document.getElementById('outputText');
    outputText.value = '';

    try {
        const selectedFiles = getSelectedFiles();
        if (selectedFiles.length === 0) {
            throw new Error('No files selected');
        }
        const fileContents = await fetchFileContents(selectedFiles);
        const formattedText = formatRepoContents(fileContents);
        outputText.value = formattedText;

        document.getElementById('copyButton').style.display = 'flex';
        document.getElementById('downloadButton').style.display = 'flex';
    } catch (error) {
        outputText.value = `Error generating text file: ${error.message}\n\n` +
            "Please ensure:\n" +
            "1. You have selected at least one file from the directory structure.\n" +
            "2. The selected files are accessible and readable.\n" +
            "3. You have sufficient permissions to read the selected files.";
    }
});

// Modify fetchFileContents to handle URL, text content, and individual files
async function fetchFileContents(files) {
    const contents = await Promise.all(files.map(async file => {
        if (file.urlType === 'zip') {
            const relativePath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
            const text = await pathZipMap[relativePath].async('text');
            return { url: file.url, path: relativePath, text };
        } else {
            // Fetch content from URL (from directory or individual files)
            const response = await fetch(file.url);
            if (!response.ok) {
                throw new Error(`Failed to fetch file: ${file.path}`);
            }
            const text = await response.text();
            return { url: file.url, path: file.path, text };
        }
    }));
    return contents;
}

// Initialize Lucide icons
document.addEventListener('DOMContentLoaded', function() {
    lucide.createIcons();
});

// Handle individual file selection
async function handleFileSelection(event) {
    const files = event.target.files;
    if (files.length === 0) return;

    // Convert FileList to array and create file objects
    const newFiles = Array.from(files).map(file => ({
        path: file.name,
        type: 'blob',
        urlType: 'individual',
        url: URL.createObjectURL(file)
    }));

    // Add to individual files array
    individualFiles.push(...newFiles);

    // Get current tree (directory or zip)
    const currentTree = getCurrentTree();
    const combinedTree = mergeFileTrees(currentTree, individualFiles);
    
    // Use default gitignore if no directory is selected
    const gitignoreContent = ['.git/**'];
    filterAndDisplayTree(combinedTree, gitignoreContent);
}

// Get current tree from directory or zip selection
function getCurrentTree() {
    // Check if directory is selected
    const directoryFiles = document.getElementById('directoryPicker').files;
    if (directoryFiles.length > 0) {
        const tree = [];
        for (let file of directoryFiles) {
            const filePath = file.webkitRelativePath.startsWith('/') ? file.webkitRelativePath.slice(1) : file.webkitRelativePath;
            tree.push({
                path: filePath,
                type: 'blob',
                urlType: 'directory',
                url: URL.createObjectURL(file)
            });
        }
        return tree;
    }
    
    // Check if zip is selected (pathZipMap will be populated)
    if (Object.keys(pathZipMap).length > 0) {
        return Object.keys(pathZipMap).map(path => ({
            path: path,
            type: 'blob',
            urlType: 'zip',
            url: path
        }));
    }
    
    return [];
}

// Merge file trees from different sources
function mergeFileTrees(mainTree, additionalFiles) {
    const combined = [...mainTree];
    
    // Add individual files, avoiding duplicates
    additionalFiles.forEach(file => {
        const exists = combined.some(existing => existing.path === file.path);
        if (!exists) {
            combined.push(file);
        }
    });
    
    return combined;
}

function isIgnored(filePath, gitignoreRules) {
    return gitignoreRules.some(rule => {
        try {
            // Convert gitignore rule to regex
            let pattern = rule.replace(/\./g, '\\.')  // Escape dots
                            .replace(/\*/g, '.*')   // Convert * to .*
                            .replace(/\?/g, '.')    // Convert ? to .
                            .replace(/\/$/, '(/.*)?$')  // Handle directory matches
                            .replace(/^\//, '^');   // Handle root-level matches

            // If the rule doesn't start with ^, it can match anywhere in the path
            if (!pattern.startsWith('^')) {
                pattern = `(^|/)${pattern}`;
            }

            const regex = new RegExp(pattern);
            return regex.test(filePath);
        } catch (error) {
            console.log('Skipping ignore check for', filePath, 'with rule', rule);
            console.log(error);
            return false;
        }
    });
}

// Function to copy text to clipboard with fallback
function copyToClipboard(text) {
    // Try using the modern Clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text)
            .then(() => console.log('Text copied to clipboard'))
            .catch(err => {
                console.error('Failed to copy text: ', err);
                return false;
            });
    } else {
        // Fallback to older execCommand method
        try {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            const success = document.execCommand('copy');
            textArea.remove();
            if (success) {
                console.log('Text copied to clipboard');
                return Promise.resolve();
            } else {
                console.error('Failed to copy text');
                return Promise.reject(new Error('execCommand returned false'));
            }
        } catch (err) {
            console.error('Failed to copy text: ', err);
            return Promise.reject(err);
        }
    }
}

// Event listener for copying text to clipboard
document.getElementById('copyButton').addEventListener('click', function () {
    const outputText = document.getElementById('outputText');
    outputText.select();
    copyToClipboard(outputText.value)
        .catch(err => console.error('Failed to copy text: ', err));
});

// Event listener for downloading text file
document.getElementById('downloadButton').addEventListener('click', function () {
    const outputText = document.getElementById('outputText').value;
    if (!outputText.trim()) {
        document.getElementById('outputText').value = 'Error: No content to download. Please generate the text file first.';
        return;
    }
    const blob = new Blob([outputText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prompt.txt';
    a.click();
    URL.revokeObjectURL(url);
});
