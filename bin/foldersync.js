const FS = require('fs');
const OS = require('os');
const Path = require('path');
const StdLib = require('@doctormckay/stdlib');
const WinAttr = require('winattr');

if (!process.argv[2] || !process.argv[3]) {
	console.error('Usage: foldersync <source> <destination>');
	process.exit(1);
}

const SRC_FOLDER = Path.normalize(process.argv[2]);
const DEST_FOLDER = Path.normalize(process.argv[3]);
const METADATA_PATH = Path.join(SRC_FOLDER, `.foldersync_metadata_${StdLib.Hashing.sha1(DEST_FOLDER)}.json`);

const copyFile = require('../lib/copyFile.js');
const readDirRecursively = require('../lib/readDirRecursively.js');
const shaFile = require('../lib/shaFile.js');

function getFileMetadata(location, relativePath) {
	return new Promise(async (resolve, reject) => {
		if (!['source', 'destination'].includes(location)) {
			return reject('\'location\' must be one of \'source\' or \'destination\'');
		}
		
		let metadata = g_Metadata[location + 'Files'][relativePath];
		let path = Path.join(location == 'source' ? SRC_FOLDER : DEST_FOLDER, relativePath);
		let stat = FS.statSync(path);
		
		if (metadata) {
			// check if mtime is the same
			if (stat.mtime.getTime() != metadata.mtime) {
				console.log(`Destination file ${relativePath} modification time has changed`);
				metadata = null;
			}
		}
		
		if (!metadata) {
			process.stdout.write(`Hashing ${location} ${relativePath}... `);
			let sha = await shaFile(path, ({processedBytes}) => {
				printProgressBar(`Hashing ${location} ${relativePath}...`, processedBytes, stat.size);
			});
			
			process.stdout.write('\n');
			metadata = {sha, mtime: stat.mtime.getTime()};
			g_Metadata[location + 'Files'][relativePath] = metadata;
		}
		
		resolve(metadata);
	});
}

function printProgressBar(prefix, value, limit) {
	if (!process.stdout.isTTY) {
		return;
	}
	
	let sizes = [60, 40, 20];
	let barWidth = 20;
	for (let i = 0; i < sizes.length; i++) {
		if (process.stdout.columns - prefix.length - 2 >= sizes[i]) {
			barWidth = sizes[i];
			break;
		}
	}
	
	let bar = StdLib.Rendering.progressBar(value, limit, barWidth, true);
	process.stdout.write(`\r${bar} ${prefix} `);
}

let g_Metadata = {destination: DEST_FOLDER, sourceFiles: {}, destinationFiles: {}};
try {
	g_Metadata = JSON.parse(FS.readFileSync(METADATA_PATH).toString('utf8'));
} catch (ex) {
	// file probably doesn't exist
}

(async function() {
	let sourceFiles = readDirRecursively(SRC_FOLDER);
	let destFiles = readDirRecursively(DEST_FOLDER);
	
	// Sync logic is as follows:
	// 1. If a file exists in the source and not the destination, copy it.
	// 2. If a file exists in both the source and the destination, compare their hashes. If they differ, copy it.
	
	// Figure out which of our source files we need to copy based on the above rules
	let sourceFilesToCopy = []
	for (let i = 0; i < sourceFiles.length; i++) {
		if (sourceFiles[i].path == METADATA_PATH) {
			// skip the metadata file
			continue;
		}
		
		let path = Path.parse(sourceFiles[i].path);
		let relativePath = Path.join(path.dir.replace(SRC_FOLDER, ''), path.base).replace(/^[\/\\]/, '');
		sourceFiles[i].relativePath = relativePath;
		
		// Does the destination file exist?
		let destPath = Path.join(DEST_FOLDER, relativePath);
		let destFile = destFiles.find(file => file.path == destPath);
		if (!destFile) {
			console.log(`File ${relativePath} does not exist in destination`);
			sourceFilesToCopy.push(sourceFiles[i]);
			continue;
		}
		
		// It exists, do we have a hash?
		let srcMeta = await getFileMetadata('source', relativePath);
		let destMeta = await getFileMetadata('destination', relativePath);
		
		// Compare hashes
		if (srcMeta.sha != destMeta.sha) {
			console.log(`File ${relativePath} hash does not match`);
			sourceFilesToCopy.push(sourceFiles[i]);
			delete g_Metadata.destinationFiles[relativePath];
		} else if (srcMeta.mtime != destMeta.mtime) {
			console.log(`File ${relativePath} modification time does not match; updating`);
			FS.utimesSync(destPath, sourceFiles[i].stat.atime, sourceFiles[i].stat.mtime);
			g_Metadata.destinationFiles[relativePath].mtime = sourceFiles[i].stat.mtime.getTime();
		}
	}
	
	// this is necessary because you get an EPERM error using 'w' if the file exists but is hidden on windows
	let flag = FS.existsSync(METADATA_PATH) ? 'r+' : 'w';
	FS.writeFileSync(METADATA_PATH, JSON.stringify(g_Metadata, undefined, '\t'), {flag});
	
	console.log(`We need to copy ${sourceFilesToCopy.length} files`);
	for (let i = 0; i < sourceFilesToCopy.length; i++) {
		let file = sourceFilesToCopy[i];
		
		let destPath = Path.join(DEST_FOLDER, file.relativePath);
		if (!FS.existsSync(Path.parse(destPath).dir)) {
			FS.mkdirSync(Path.parse(destPath).dir, {recursive: true});
		}
		
		process.stdout.write(`Copying ${file.relativePath}... `);
		let srcHash = await copyFile(file.path, destPath, ({processedBytes}) => {
			printProgressBar(`Copying ${file.relativePath}...`, processedBytes, file.stat.size);
		});
		
		process.stdout.write('\n');
		FS.utimesSync(destPath, file.stat.atime, file.stat.mtime);
		
		process.stdout.write(`Verifying... `);
		let sha = await shaFile(destPath, ({processedBytes}) => {
			printProgressBar('Verifying...', processedBytes, file.stat.size);
		});
		
		process.stdout.write('\n');
		if (sha != srcHash) {
			console.log(`ERROR: Hash of source (${g_Metadata.sourceFiles[file.relativePath].sha}) does not match destination (${sha})!!`);
			FS.unlinkSync(destPath);
		} else {
			g_Metadata.sourceFiles[file.relativePath] = g_Metadata.destinationFiles[file.relativePath] = {
				sha,
				mtime: file.stat.mtime.getTime()
			};
		}
	}
	
	flag = FS.existsSync(METADATA_PATH) ? 'r+' : 'w';
	FS.writeFileSync(METADATA_PATH, JSON.stringify(g_Metadata, undefined, '\t'), {flag});
	if (OS.platform() == 'win32') {
		WinAttr.setSync(METADATA_PATH, {hidden: true});
	}
	
	console.log('Done');
})();
