/**
 * Safely copy text to the clipboard, supporting both secure (HTTPS)
 * and non-secure (HTTP) contexts.
 * 
 * @param {string} text - The text to copy
 * @returns {Promise<boolean>} Resolves to true if successful, false otherwise
 */
export const copyToClipboard = async (text) => {
    // Try modern Clipboard API if available and in a secure context
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            console.warn('Modern clipboard API failed, trying fallback...', err);
        }
    }

    // Fallback approach for HTTP / non-secure contexts
    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        
        // Avoid scrolling to bottom
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (successful) {
            return true;
        }
        throw new Error('execCommand copy returned false');
    } catch (err) {
        console.error('Fallback copy to clipboard failed:', err);
        return false;
    }
};
