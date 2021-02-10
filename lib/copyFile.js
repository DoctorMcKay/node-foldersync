const FS = require('fs');
const Stream = require('stream');

const ProgressStream = require('./ProgressStream.js');

function copyFile(srcPath, destPath, onProgress) {
	return new Promise((resolve, reject) => {
		let readStream = FS.createReadStream(srcPath);
		let writeStream = FS.createWriteStream(destPath);
		let progressStream = new ProgressStream();
		
		if (typeof onProgress == 'function') {
			progressStream.on('progress', onProgress);
		}
		
		let hash = null;
		progressStream.on('hash', h => hash = h);
		
		Stream.pipeline(readStream, progressStream, writeStream, (err) => {
			if (err) {
				reject(err);
			} else {
				resolve(hash);
			}
		});
	});
}

module.exports = copyFile;
