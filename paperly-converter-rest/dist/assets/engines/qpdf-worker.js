importScripts('./qpdf.js');
self.onmessage = async ({ data }) => {
  try {
    const qpdf = await Module({ noInitialRun: true, locateFile: () => new URL('qpdf.wasm', self.location.href).href, print: () => {}, printErr: () => {} });
    qpdf.FS.writeFile('/input.pdf', new Uint8Array(data.bytes));
    const args = data.mode === 'protect'
      ? ['/input.pdf', '--encrypt', data.password, data.ownerPassword, '256', '--', '/output.pdf']
      : data.mode === 'unlock'
        ? [`--password=${data.password}`, '--decrypt', '/input.pdf', '/output.pdf']
        : data.mode === 'compress'
          ? ['--warning-exit-0', '--object-streams=generate', '--recompress-flate', '--compression-level=9', '/input.pdf', '/output.pdf']
          : ['--warning-exit-0', '/input.pdf', '/output.pdf'];
    try { qpdf.callMain(args); } catch (error) { if (error.status !== 0 && error.status !== 3) throw error; }
    const bytes = qpdf.FS.readFile('/output.pdf');
    if (!bytes.length) throw new Error('No output was produced.');
    const result = bytes.slice().buffer;
    self.postMessage({ bytes: result }, [result]);
  } catch { self.postMessage({ error: data.mode === 'unlock' ? 'Unable to unlock this PDF. Check the password and try again.' : 'The PDF engine could not process this file. It may be damaged, encrypted, or unsupported.' }); }
};
