// Installs the SHA-256 fallback before anything else in a Worker runs (ES modules evaluate their imports in order).
import {installDigest} from './digest.js'

installDigest()
