// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice URL invariants that must be checked before trusting Web2Json response data.
/// @dev This deliberately accepts only the canonical ASCII URL form emitted by Proofline.
library ProoflineUrlInvariant {
    error SchemeMismatch();
    error HostMismatch();
    error PathPrefixMismatch();
    error QueryValueMismatch();

    function requireScheme(string memory requestUrl, string memory expectedScheme) internal pure {
        bytes memory url = bytes(requestUrl);
        bytes memory scheme = bytes(expectedScheme);
        if (
            url.length < scheme.length + 3 ||
            !_equalsAt(url, 0, scheme) ||
            url[scheme.length] != ":" ||
            url[scheme.length + 1] != "/" ||
            url[scheme.length + 2] != "/"
        ) revert SchemeMismatch();
    }

    function requireHost(string memory requestUrl, string memory expectedHost) internal pure {
        bytes memory url = bytes(requestUrl);
        bytes memory host = bytes(expectedHost);
        uint256 start = _authorityStart(url);
        uint256 end = start;
        while (end < url.length && url[end] != "/" && url[end] != "?" && url[end] != "#") {
            unchecked { ++end; }
        }
        if (end - start != host.length || !_equalsAt(url, start, host)) {
            revert HostMismatch();
        }
    }

    function requirePathPrefix(string memory requestUrl, string memory expectedPrefix) internal pure {
        bytes memory url = bytes(requestUrl);
        bytes memory prefix = bytes(expectedPrefix);
        uint256 start = _authorityStart(url);
        while (start < url.length && url[start] != "/" && url[start] != "?" && url[start] != "#") {
            unchecked { ++start; }
        }
        if (prefix.length == 0 || prefix[0] != "/" || !_equalsAt(url, start, prefix)) {
            revert PathPrefixMismatch();
        }
        uint256 boundary = start + prefix.length;
        if (
            prefix[prefix.length - 1] != "/" &&
            boundary < url.length &&
            url[boundary] != "/" &&
            url[boundary] != "?" &&
            url[boundary] != "#"
        ) revert PathPrefixMismatch();
    }

    function requireQueryValue(
        string memory requestUrl,
        string memory expectedKey,
        string memory expectedValue
    ) internal pure {
        bytes memory url = bytes(requestUrl);
        bytes memory key = bytes(expectedKey);
        bytes memory value = bytes(expectedValue);
        uint256 cursor;
        while (cursor < url.length && url[cursor] != "?") {
            unchecked { ++cursor; }
        }
        if (cursor == url.length) revert QueryValueMismatch();
        unchecked { ++cursor; }

        while (cursor <= url.length) {
            uint256 pairEnd = cursor;
            uint256 equalsAt = type(uint256).max;
            while (pairEnd < url.length && url[pairEnd] != "&" && url[pairEnd] != "#") {
                if (url[pairEnd] == "=" && equalsAt == type(uint256).max) equalsAt = pairEnd;
                unchecked { ++pairEnd; }
            }
            if (
                equalsAt != type(uint256).max &&
                equalsAt - cursor == key.length &&
                pairEnd - equalsAt - 1 == value.length &&
                _equalsAt(url, cursor, key) &&
                _equalsAt(url, equalsAt + 1, value)
            ) return;
            if (pairEnd >= url.length || url[pairEnd] == "#") break;
            cursor = pairEnd + 1;
        }
        revert QueryValueMismatch();
    }

    function _authorityStart(bytes memory url) private pure returns (uint256 start) {
        while (start + 2 < url.length) {
            if (url[start] == ":" && url[start + 1] == "/" && url[start + 2] == "/") {
                return start + 3;
            }
            unchecked { ++start; }
        }
        revert SchemeMismatch();
    }

    function _equalsAt(
        bytes memory source,
        uint256 start,
        bytes memory expected
    ) private pure returns (bool) {
        if (start + expected.length > source.length) return false;
        for (uint256 index; index < expected.length; ) {
            if (source[start + index] != expected[index]) return false;
            unchecked { ++index; }
        }
        return true;
    }
}
