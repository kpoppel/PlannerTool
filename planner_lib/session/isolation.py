"""Process-level sandbox egress policy; installed only in isolated processes."""
import ipaddress
import socket
import sys


def install_sandbox_egress(host):
    hosts = {'localhost', '127.0.0.1', '::1', host}
    addresses = {value[4][0] for value in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)}

    def check(event, arguments):
        if event == 'socket.getaddrinfo':
            target = arguments[0]
            if target not in hosts and target not in addresses:
                raise PermissionError('Sandbox prohibits external network resolution')
        if event == 'socket.connect':
            connection, target = arguments
            if connection.family not in (socket.AF_INET, socket.AF_INET6):
                return
            address = target[0]
            if address in addresses:
                return
            if not ipaddress.ip_address(address).is_loopback:
                raise PermissionError('Sandbox prohibits external network connections')

    sys.addaudithook(check)