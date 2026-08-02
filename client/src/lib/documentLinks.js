export function getDocumentUrl(file) {
  return String(file?.public_url || file?.file_url || file?.server_file_url || '').trim();
}

export function toPreviewDocument(file) {
  const resolvedUrl = getDocumentUrl(file);
  return {
    ...file,
    file_url: resolvedUrl,
    public_url: resolvedUrl,
  };
}
