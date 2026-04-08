import os
import re

def hyphenate(match):
    var_name = match.group(1)
    new_var = var_name.replace('_', '-')
    return f'process.env["{new_var}"]'

def hyphenate_bracket(match):
    var_name = match.group(1)
    new_var = var_name.replace('_', '-')
    return f'process.env["{new_var}"]'

def refactor_node_backend(directory):
    count = 0
    pattern1 = re.compile(r'process\.env\.([A-Z0-9_]+)')
    pattern2 = re.compile(r'process\.env\["([A-Z0-9_]+)"\]')
    
    for root, _, files in os.walk(directory):
        if 'node_modules' in root or '.git' in root or 'dist' in root:
            continue
        for file in files:
            if file.endswith(('.ts', '.tsx', '.js', '.jsx')):
                filepath = os.path.join(root, file)
                with open(filepath, 'r') as f:
                    content = f.read()

                new_content = pattern1.sub(hyphenate, content)
                new_content = pattern2.sub(hyphenate_bracket, new_content)

                if new_content != content:
                    with open(filepath, 'w') as f:
                        f.write(new_content)
                    print(f"Updated {filepath}")
                    count += 1
    return count

print("Starting node_backend refactor...")
c = refactor_node_backend('/Users/excollodev/Desktop/Financial-Document-Intelligence/node_backend')
print(f"Done modifying {c} files.")
