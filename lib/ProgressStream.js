const Crypto = require('crypto');
const Stream = require('stream');

class ProgressStream extends Stream.Transform {
	constructor(options) {
		super(options);
		
		this.processedBytes = 0;
		
		this._hash = Crypto.createHash('sha1');
		this._progressInterval = setInterval(() => {
			this.emit('progress', {processedBytes: this.processedBytes});
		}, 500);
	}
	
	_transform(chunk, encoding, callback) {
		this._hash.update(chunk);
		this.processedBytes += chunk.length;
		this.push(chunk);
		callback();
	}
	
	_flush(callback) {
		clearInterval(this._progressInterval);
		this.emit('progress', {processedBytes: this.processedBytes});
		this.emit('hash', this._hash.digest('hex'));
		callback();
	}
}

module.exports = ProgressStream;
