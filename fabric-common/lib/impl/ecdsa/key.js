/*
 Copyright 2016, 2018 IBM All Rights Reserved.

 SPDX-License-Identifier: Apache-2.0

*/

'use strict';

const Key = require('../../Key');
const HashPrimitives = require('../../HashPrimitives');
const jsrsa = require('jsrsasign');
const asn1 = jsrsa.asn1;
const KEYUTIL = jsrsa.KEYUTIL;
const ECDSA = jsrsa.ECDSA;
const jws = jsrsa.jws;

/**
 * This module implements the {@link module:api.Key} interface, for ECDSA.
 * @class ECDSA_KEY
 * @extends module:api.Key
 */
class ECDSA_KEY extends Key {
	/**
	 * this class represents the private or public key of an ECDSA key pair.
	 *
	 * @param {Object} key This must be the "privKeyObj" or "pubKeyObj" part of the object generated by jsrsasign.KEYUTIL.generateKeypair()
	 */
	constructor(key) {
		if (!key) {
			throw new Error('The key parameter is required by this key class implementation, whether this instance is for the public key or private key');
		}

		if (!key.type || key.type !== 'EC') {
			throw new Error('This key implementation only supports keys generated by jsrsasign.KEYUTIL. It must have a "type" property of value "EC"');
		}

		// pubKeyHex must have a non-null value
		if (!key.pubKeyHex) {
			throw new Error('This key implementation only supports keys generated by jsrsasign.KEYUTIL. It must have a "pubKeyHex" property');
		}

		// prvKeyHex value can be null for public keys

		super();
		this._key = (typeof key === 'undefined') ? null : key;
	}

	/**
	 * @returns {string} a string representation of the hash from a sequence based on the private key bytes
	 */
	getSKI() {
		let buff;

		const pointToOctet = function (key) {
			const byteLen = (key.ecparams.keylen + 7) >> 3;
			const newBuff = Buffer.allocUnsafe(1 + 2 * byteLen);
			newBuff[0] = 4; // uncompressed point (https://www.security-audit.com/files/x9-62-09-20-98.pdf, section 4.3.6)
			const xyhex = key.getPublicKeyXYHex();
			const xBuffer = Buffer.from(xyhex.x, 'hex');
			const yBuffer = Buffer.from(xyhex.y, 'hex');
			xBuffer.copy(newBuff, 1 + byteLen - xBuffer.length);
			yBuffer.copy(newBuff, 1 + 2 * byteLen - yBuffer.length);
			return newBuff;
		};

		if (this._key.isPublic) {
			// referencing implementation of the Marshal() method of https://golang.org/src/crypto/elliptic/elliptic.go
			buff = pointToOctet(this._key);
		} else {
			buff = pointToOctet(this.getPublicKey()._key);
		}

		// always use SHA256 regardless of the key size in effect
		return HashPrimitives.SHA2_256(buff);
	}

	/**
	 * Not supported by non PKCS11 keys.
	 * Only PKCS11 keys have a handle used by the HSM internally to access the key.
	 *
	 * @throws Error
	 */
	getHandle() {
		throw Error('This key does not have a PKCS11 handle');
	}

	isSymmetric() {
		return false;
	}

	isPrivate() {
		if (typeof this._key.prvKeyHex !== 'undefined' && this._key.prvKeyHex === null) {
			return false;
		} else {
			return true;
		}
	}

	getPublicKey() {
		if (this._key.isPublic) {
			return this;
		} else {
			const f = new ECDSA({curve: this._key.curveName});
			f.setPublicKeyHex(this._key.pubKeyHex);
			f.isPrivate = false;
			f.isPublic = true;
			return new ECDSA_KEY(f);
		}
	}

	/**
	 * Generates a CSR/PKCS#10 certificate signing request for this key
	 * @param {string} subjectDN The X500Name for the certificate request in LDAP(RFC 2253) format
	 * @param {Object[]} [extensions] Additional X.509v3 extensions for the certificate signing request
	 * @returns {string} PEM-encoded PKCS#10 certificate signing request
	 * @throws Will throw an error if this is not a private key
	 * @throws Will throw an error if CSR generation fails for any other reason
	 */
	generateCSR(subjectDN, extensions) {

		// check to see if this is a private key
		if (!this.isPrivate()) {
			throw new Error('A CSR cannot be generated from a public key');
		}

		const csr = asn1.csr.CSRUtil.newCSRPEM({
			subject: {str: asn1.x509.X500Name.ldapToOneline(subjectDN)},
			sbjpubkey: this.getPublicKey()._key,
			sigalg: 'SHA256withECDSA',
			sbjprvkey: this._key,
			ext: extensions
		});
		return csr;
	}

	/**
	 * Generates a self-signed X.509 certificate
	 * @param {string} [subjectDN] The subject to use for the X509 certificate
	 * @returns {string} PEM-encoded X.509 certificate
	 * @throws Will throw an error if this is not a private key
	 * @throws Will throw an error if X.509 certificate generation fails for any other reason
	 */
	generateX509Certificate(subjectDN = '/CN=self') {

		// check to see if this is a private key
		if (!this.isPrivate()) {
			throw new Error('An X509 certificate cannot be generated from a public key');
		}

		const certPEM = asn1.x509.X509Util.newCertPEM({
			serial: {int: 4},
			sigalg: {name: 'SHA256withECDSA'},
			issuer: {str: subjectDN},
			notbefore: {'str': jws.IntDate.intDate2Zulu(jws.IntDate.getNow() - 5000)},
			notafter: {'str': jws.IntDate.intDate2Zulu(jws.IntDate.getNow() + 60000)},
			subject: {str: subjectDN},
			sbjpubkey: this.getPublicKey()._key,
			ext: [
				{
					basicConstraints: {
						cA: false,
						critical: true
					}
				},
				{
					keyUsage: {bin: '11'}
				},
				{
					extKeyUsage: {
						array: [{name: 'clientAuth'}]
					}
				}
			],
			cakey: this._key
		});
		return certPEM;
	}

	toBytes() {
		// this is specific to the private key format generated by
		// npm module 'jsrsasign.KEYUTIL'
		if (this.isPrivate()) {
			return KEYUTIL.getPEM(this._key, 'PKCS8PRV');
		} else {
			return KEYUTIL.getPEM(this._key);
		}
	}
}

module.exports = ECDSA_KEY;
