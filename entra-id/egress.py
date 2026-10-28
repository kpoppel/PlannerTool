"""Sandbox processes must not contact Microsoft or Azure DevOps."""
import ipaddress
import socket
import sys


def install_sandbox_egress():
    def check(event, arguments):
        if event == 'socket.getaddrinfo' and arguments[0] not in ('localhost', '127.0.0.1', '::1'):
            raise PermissionError('Sandbox prohibits external network resolution')
        if event == 'socket.connect':
            connection, target = arguments
            if connection.family in (socket.AF_INET, socket.AF_INET6):
                if not ipaddress.ip_address(target[0]).is_loopback:
                    raise PermissionError('Sandbox prohibits external network connections')

    sys.addaudithook(check)