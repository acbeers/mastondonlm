"""Tests for utility functions"""

import json
import logging
from unittest.mock import MagicMock, patch, sentinel
from unittest import TestCase
import utils


class TestUtils(TestCase):
    """Tests for /auth methods"""

    def test_cleandomain_url(self):
        """Test cleandomain with a URL"""
        res = utils.cleandomain("https://domain")
        self.assertEqual(res, "domain")

    def test_cleandomain_account(self):
        """Test cleandomain with an account name"""
        res = utils.cleandomain("user@somedomain")
        self.assertEqual(res, "somedomain")

    def test_cleandomain_garbase(self):
        """Test cleandomain with a bunch of junk"""
        res = utils.cleandomain("aBc12#$%3_ruie[-")
        self.assertEqual(res, "abc123_ruie-")