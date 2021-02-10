const Crypto = require('crypto');
const FS = require('fs');

function shaFile(filePath, onProgress) {
	return new Promise((resolve, reject) => {
		let hash = Crypto.createHash('sha1');
		let stream = FS.createReadStream(filePath);
		
		let processedBytes = 0;
		
		let progressInterval = setInterval(() => {
			if (typeof onProgress == 'function') {
				onProgress({processedBytes});
			}
		}, 100);
		
		stream.on('data', (chunk) => {
			hash.update(chunk);
			processedBytes += chunk.length;
		});
		
		stream.on('end', () => {
			clearInterval(progressInterval);
			
			if (typeof onProgress == 'function') {
				onProgress({processedBytes});
			}
			
			resolve(hash.digest('hex'));
		});
		
		stream.on('error', reject);
	});
}

module.exports = shaFile;
